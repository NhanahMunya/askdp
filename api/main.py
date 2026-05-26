import time
import os
import uuid
import sentry_sdk
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic
import psycopg
import sqlglot
import pandas as pd
from io import StringIO
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv("../.env")

# Sentry
sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    send_default_pii=True,
    traces_sample_rate=1.0,
)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://askdp.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Hardcoded Chinook schema (fallback) ──────────────────────────────────────
CHINOOK_SCHEMA = """
CREATE TABLE artist (artist_id SERIAL PRIMARY KEY, name VARCHAR(120));
CREATE TABLE album (album_id SERIAL PRIMARY KEY, title VARCHAR(160), artist_id INT REFERENCES artist);
CREATE TABLE genre (genre_id SERIAL PRIMARY KEY, name VARCHAR(120));
CREATE TABLE media_type (media_type_id SERIAL PRIMARY KEY, name VARCHAR(120));
CREATE TABLE track (
    track_id SERIAL PRIMARY KEY, name VARCHAR(200), album_id INT REFERENCES album,
    media_type_id INT REFERENCES media_type, genre_id INT REFERENCES genre,
    composer VARCHAR(220), milliseconds INT, bytes INT, unit_price NUMERIC(10,2)
);
CREATE TABLE employee (
    employee_id SERIAL PRIMARY KEY, last_name VARCHAR(20), first_name VARCHAR(20),
    title VARCHAR(30), reports_to INT REFERENCES employee,
    hire_date TIMESTAMP, city VARCHAR(40), country VARCHAR(40), email VARCHAR(60)
);
CREATE TABLE customer (
    customer_id SERIAL PRIMARY KEY, first_name VARCHAR(40), last_name VARCHAR(20),
    company VARCHAR(80), city VARCHAR(40), country VARCHAR(40),
    email VARCHAR(60), support_rep_id INT REFERENCES employee
);
CREATE TABLE invoice (
    invoice_id SERIAL PRIMARY KEY, customer_id INT REFERENCES customer,
    invoice_date TIMESTAMP, billing_city VARCHAR(40),
    billing_country VARCHAR(40), total NUMERIC(10,2)
);
CREATE TABLE invoice_line (
    invoice_line_id SERIAL PRIMARY KEY, invoice_id INT REFERENCES invoice,
    track_id INT REFERENCES track, unit_price NUMERIC(10,2), quantity INT
);
CREATE TABLE playlist (playlist_id SERIAL PRIMARY KEY, name VARCHAR(120));
CREATE TABLE playlist_track (playlist_id INT REFERENCES playlist, track_id INT REFERENCES track);
"""

MAX_ROWS = 100
STATEMENT_TIMEOUT_MS = 5000


# ── Pandas dtype → Postgres type mapping ─────────────────────────────────────
def pandas_dtype_to_pg(dtype) -> str:
    if pd.api.types.is_integer_dtype(dtype):
        return "BIGINT"
    if pd.api.types.is_float_dtype(dtype):
        return "DOUBLE PRECISION"
    if pd.api.types.is_bool_dtype(dtype):
        return "BOOLEAN"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "TIMESTAMP"
    return "TEXT"


# ── Build CREATE TABLE string from a DataFrame ────────────────────────────────
def build_schema_string(schema_name: str, table_name: str, df: pd.DataFrame) -> str:
    cols = []
    for col, dtype in df.dtypes.items():
        safe_col = col.lower().replace(" ", "_").replace("-", "_")
        pg_type = pandas_dtype_to_pg(dtype)
        cols.append(f"    {safe_col} {pg_type}")
    col_str = ",\n".join(cols)
    return f'CREATE TABLE {schema_name}.{table_name} (\n{col_str}\n);'


# ── Safety check: SELECT only ─────────────────────────────────────────────────
def is_select_only(sql: str) -> bool:
    try:
        statements = sqlglot.parse(sql.rstrip(";"), dialect="postgres")
        if not statements:
            return False
        for statement in statements:
            if not isinstance(statement, sqlglot.expressions.Select):
                return False
        return True
    except Exception:
        return False


# ── Query logger ──────────────────────────────────────────────────────────────
def log_query(
    question: str,
    sql: str,
    result_rows: int,
    error: str | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    duration_ms: int,
    ip_address: str,
):
    try:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO query_log
                (question, sql_generated, result_rows, error, model,
                 input_tokens, output_tokens, duration_ms, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (question, sql, result_rows, error, model,
             input_tokens, output_tokens, duration_ms, ip_address),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        sentry_sdk.capture_exception(e)

# Self healing sql logic
def log_retry(
    question: str,
    original_sql: str,
    error: str,
    retry_number: int,
    healed_sql: str,
    healed_successfully: bool,
):
    try:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO query_retry_log
                (question, original_sql, error, retry_number,
                 healed_sql, healed_successfully)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (question, original_sql, error, retry_number,
             healed_sql, healed_successfully),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        sentry_sdk.capture_exception(e)


def heal_query(
    client: anthropic.Anthropic,
    question: str,
    schema_context: str,
    failed_sql: str,
    error: str,
    attempt: int,
) -> tuple[str, list[str], str | None]:
    """Ask Claude to fix a failed SQL query. Returns (sql, display_columns, chart_hint)."""
    import json

    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": f"""You are a SQL expert. A query you generated failed.

                Schema:
                {schema_context}

                Original question: {question}

                Failed SQL:
                {failed_sql}

                Error:
                {error}

                Fix the SQL so it answers the original question correctly.

                Return a JSON object with exactly these fields:
                {{
                "sql": "the corrected SQL query",
                "display_columns": ["col1", "col2"],
                "chart_hint": "bar" | "line" | "pie" | "scatter" | null
                }}

                Rules:
                - "sql": valid Postgres SQL, no markdown, no backticks
                - "display_columns": only columns a non-technical human would want to see, exclude _id columns unless asked
                - "chart_hint": suggest chart type if numeric result, null otherwise

                Return ONLY the JSON object. No explanation, no markdown, no backticks.""",
            }
        ],
    )

    raw = message.content[0].text.strip()
    try:
        clean = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        sql = parsed.get("sql", "").strip()
        display_columns = parsed.get("display_columns", [])
        chart_hint = parsed.get("chart_hint", None)
        return sql, display_columns, chart_hint
    except Exception:
        return raw.strip(), [], None

# ── Models ────────────────────────────────────────────────────────────────────
class HistoryEntry(BaseModel):
    question: str
    sql: str

class AskRequest(BaseModel):
    question: str
    session_id: str | None = None
    history: list[HistoryEntry] = []


class AskResponse(BaseModel):
    sql: str
    results: list
    display_columns: list[str] = []
    chart_hint: str | None = None
    error: str | None = None
    truncated: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


class UploadResponse(BaseModel):
    session_id: str
    table_name: str
    schema_string: str
    row_count: int
    column_count: int


# ── Upload endpoint ───────────────────────────────────────────────────────────
@app.post("/api/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...)):
    # Read CSV
    contents = await file.read()
    df = pd.read_csv(StringIO(contents.decode("utf-8")))

    # Sanitize column names
    df.columns = [
        col.lower().replace(" ", "_").replace("-", "_")
        for col in df.columns
    ]

    # Generate session
    session_id = uuid.uuid4().hex[:12]
    schema_name = f"session_{session_id}"
    table_name = (
        os.path.splitext(file.filename)[0]
        .lower()
        .replace(" ", "_")
        .replace("-", "_")[:40]
    )

    # Create schema and table in Neon, insert data
    conn = psycopg.connect(os.getenv("DATABASE_URL"))
    cur = conn.cursor()

    # Create session schema
    cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"')

    # Create table
    col_defs = []
    for col, dtype in df.dtypes.items():
        pg_type = pandas_dtype_to_pg(dtype)
        col_defs.append(f'"{col}" {pg_type}')
    create_sql = (
        f'CREATE TABLE "{schema_name}"."{table_name}" '
        f'({", ".join(col_defs)})'
    )
    cur.execute(create_sql)

    # Track session expiry
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.upload_sessions (
            session_id TEXT PRIMARY KEY,
            schema_name TEXT,
            table_name TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        "INSERT INTO public.upload_sessions (session_id, schema_name, table_name) VALUES (%s, %s, %s)",
        (session_id, schema_name, table_name),
    )

    # Insert rows in batches
    cols = ', '.join([f'"{c}"' for c in df.columns])
    placeholders = ', '.join(['%s'] * len(df.columns))
    insert_sql = (
        f'INSERT INTO "{schema_name}"."{table_name}" ({cols}) '
        f'VALUES ({placeholders})'
    )
    for _, row in df.iterrows():
        cur.execute(insert_sql, tuple(
            None if pd.isna(v) else v for v in row.values
        ))

    conn.commit()
    cur.close()
    conn.close()

    schema_string = build_schema_string(schema_name, table_name, df)

    return UploadResponse(
        session_id=session_id,
        table_name=table_name,
        schema_string=schema_string,
        row_count=len(df),
        column_count=len(df.columns),
    )


# ── Ask endpoint 
@app.post("/api/ask", response_model=AskResponse)
@limiter.limit("10/minute")
async def ask(req: AskRequest, request: Request):   
    start = time.time()
    ip = get_remote_address(request)
    model_name = "claude-sonnet-4-5"
    sql = ""
    input_tokens = 0
    output_tokens = 0

    # Resolve schema — CSV session or Chinook fallback
    if req.session_id:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(
            "SELECT schema_name, table_name FROM upload_sessions WHERE session_id = %s",
            (req.session_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if row:
            schema_name, table_name = row
            # Introspect live columns from Postgres
            conn = psycopg.connect(os.getenv("DATABASE_URL"))
            cur = conn.cursor()
            cur.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                (schema_name, table_name),
            )
            columns = cur.fetchall()
            cur.close()
            conn.close()

            col_defs = ", ".join(
                [f"{col} {dtype}" for col, dtype in columns]
            )
            active_schema = (
                f"CREATE TABLE {schema_name}.{table_name} ({col_defs});"
            )
            schema_context = (
                f"You are querying a user-uploaded CSV table.\n{active_schema}\n"
                f"Always prefix the table name with the schema: "
                f"{schema_name}.{table_name}"
            )
        else:
            # session_id not found — fall back to Chinook
            schema_context = (
                "Session not found. Falling back to the Chinook music store database.\n"
                + CHINOOK_SCHEMA
            )
    else:
        schema_context = (
            "No CSV uploaded. Using the Chinook music store database.\n"
            + CHINOOK_SCHEMA
        )

    # Ask Claude
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    # Build multi-turn message history
    history_messages = []
    for entry in req.history[-4:]:  # last 4 exchanges
        history_messages.append({
            "role": "user",
            "content": entry.question
        })
        history_messages.append({
            "role": "assistant",
            "content": f'{{"sql": "{entry.sql}", "display_columns": [], "chart_hint": null}}'
        })

    # Add current question
    history_messages.append({
        "role": "user",
        "content": f"""You are a SQL expert and a product designer who cares about clean data presentation.

        Given this Postgres schema:
        {schema_context}

        Generate a SQL query to answer: {req.question}

        Return a JSON object with exactly these fields:
        {{
        "sql": "the complete SQL query",
        "display_columns": ["col1", "col2"],
        "chart_hint": "bar" | "line" | "pie" | "scatter" | null
        }}

        Rules:
        - "sql": valid Postgres SQL, no markdown, no backticks
        - "display_columns": only the columns a non-technical human would want to see. Exclude primary keys and foreign keys (columns ending in _id) unless the question specifically asks for them. Always include the columns that directly answer the question.
        - "chart_hint": suggest a chart type if the result is numeric and visual. Use "line" for time series, "pie" for <= 8 categories, "bar" for > 8 categories or comparisons, "scatter" for two numeric columns, null if not chartable.

        Use the conversation history above to understand context — if the user says "now break that down by month" or "show me more of those", refer to the previous question and SQL to understand what they mean.

        Return ONLY the JSON object. No explanation, no markdown, no backticks."""
    })

    message = client.messages.create(
        model=model_name,
        max_tokens=1024,
        system="You are a SQL expert with memory of the current conversation. Use prior questions and SQL to understand follow-up questions.",
        messages=history_messages,
    )

    raw = message.content[0].text.strip()
    input_tokens = message.usage.input_tokens
    output_tokens = message.usage.output_tokens

    # Parse structured output
    import json
    try:
        # Strip markdown fences if model adds them anyway
        clean = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        sql = parsed.get("sql", "").strip()
        display_columns = parsed.get("display_columns", [])
        chart_hint = parsed.get("chart_hint", None)
    except Exception:
        # Fallback: treat entire response as raw SQL
        sql = raw
        display_columns = []
        chart_hint = None

    # Safety check
    if not is_select_only(sql):
        duration_ms = int((time.time() - start) * 1000)
        log_query(req.question, sql, 0,
                  "Only read queries allowed.", model_name,
                  input_tokens, output_tokens, duration_ms, ip)
        return AskResponse(
            sql=sql,
            results=[],
            display_columns=[],
            chart_hint=None,
            error="Only read queries allowed. The model generated a non-SELECT statement.",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    # Execute with self-healing retry loop
    MAX_RETRIES = 2
    current_sql = sql
    current_display_columns = display_columns
    current_chart_hint = chart_hint
    last_error = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            conn = psycopg.connect(os.getenv("DATABASE_URL"))
            cur = conn.cursor()
            cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
            limited_sql = (
                f"SELECT * FROM ({current_sql.rstrip(';')}) AS _q LIMIT {MAX_ROWS + 1}"
            )
            cur.execute(limited_sql)
            cols = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            truncated = len(rows) > MAX_ROWS
            rows = rows[:MAX_ROWS]
            results = [dict(zip(cols, row)) for row in rows]
            cur.close()
            conn.close()

            duration_ms = int((time.time() - start) * 1000)
            log_query(
                req.question, current_sql, len(results), None,
                model_name, input_tokens, output_tokens, duration_ms, ip
            )

            return AskResponse(
                sql=current_sql,
                results=results,
                display_columns=current_display_columns,
                chart_hint=current_chart_hint,
                error=None,
                truncated=truncated,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        except Exception as e:
            last_error = str(e)

            # Log the failure
            log_query(
                req.question, current_sql, 0, last_error,
                model_name, input_tokens, output_tokens,
                int((time.time() - start) * 1000), ip
            )

            if attempt < MAX_RETRIES:
                # Try to heal
                healed_sql, healed_cols, healed_hint = heal_query(
                    client=client,
                    question=req.question,
                    schema_context=schema_context,
                    failed_sql=current_sql,
                    error=last_error,
                    attempt=attempt + 1,
                )

                healed_successfully = healed_sql != current_sql
                log_retry(
                    question=req.question,
                    original_sql=current_sql,
                    error=last_error,
                    retry_number=attempt + 1,
                    healed_sql=healed_sql,
                    healed_successfully=healed_successfully,
                )

                current_sql = healed_sql
                if healed_cols:
                    current_display_columns = healed_cols
                if healed_hint:
                    current_chart_hint = healed_hint
            else:
                # All retries exhausted
                sentry_sdk.capture_exception(e)

    duration_ms = int((time.time() - start) * 1000)
    return AskResponse(
        sql=current_sql,
        results=[],
        display_columns=[],
        chart_hint=None,
        error=f"Query failed after {MAX_RETRIES} retries. Last error: {last_error}",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )