import time
import os
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import anthropic
import psycopg
import sqlglot
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


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    sql: str
    results: list
    error: str | None = None
    truncated: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


def is_select_only(sql: str) -> bool:
    try:
        statements = sqlglot.parse(sql, dialect="postgres")
        if not statements:
            return False
        for statement in statements:
            if not isinstance(statement, sqlglot.expressions.Select):
                return False
        return True
    except Exception:
        return False


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


@app.post("/api/ask", response_model=AskResponse)
@limiter.limit("10/minute")
async def ask(req: AskRequest, request: Request):
    start = time.time()
    ip = get_remote_address(request)
    model_name = "claude-sonnet-4-5"
    sql = ""
    input_tokens = 0
    output_tokens = 0

    # Step 1: Ask Claude to generate SQL
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    message = client.messages.create(
        model=model_name,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": f"""You are a SQL expert. Given this Postgres schema:

{CHINOOK_SCHEMA}

Generate a SQL query to answer: {req.question}

Return ONLY the SQL query, no explanation, no markdown, no backticks.""",
            }
        ],
    )

    sql = message.content[0].text.strip()
    input_tokens = message.usage.input_tokens
    output_tokens = message.usage.output_tokens

    # Step 2: Safety check
    if not is_select_only(sql):
        duration_ms = int((time.time() - start) * 1000)
        log_query(req.question, sql, 0,
                  "Only read queries allowed.", model_name,
                  input_tokens, output_tokens, duration_ms, ip)
        return AskResponse(
            sql=sql,
            results=[],
            error="Only read queries allowed. The model generated a non-SELECT statement.",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    # Step 3: Execute against Postgres
    try:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
        limited_sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT {MAX_ROWS + 1}"
        cur.execute(limited_sql)
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]
        results = [dict(zip(columns, row)) for row in rows]
        cur.close()
        conn.close()

        duration_ms = int((time.time() - start) * 1000)
        log_query(req.question, sql, len(results), None, model_name,
                  input_tokens, output_tokens, duration_ms, ip)

        return AskResponse(
            sql=sql,
            results=results,
            error=None,
            truncated=truncated,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        log_query(req.question, sql, 0, str(e), model_name,
                  input_tokens, output_tokens, duration_ms, ip)
        sentry_sdk.capture_exception(e)
        return AskResponse(
            sql=sql,
            results=[],
            error=str(e),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )