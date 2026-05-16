from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic
import psycopg
import sqlglot
import os
from dotenv import load_dotenv

load_dotenv("../.env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
    
#Ensuring that all sqls allowed are only for reading and not updating or deleting or dropping 
def is_select_only(sql: str) -> bool:
    """Use sqlglot to parse the SQL and confirm it's a SELECT statement only."""
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

@app.post("/api/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    # Step 1: Ask Claude to generate SQL
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": f"""You are a SQL expert. Given this Postgres schema:

{CHINOOK_SCHEMA}

Generate a SQL query to answer: {req.question}

Return ONLY the SQL query, no explanation, no markdown, no backticks."""
            }
        ]
    )

    sql = message.content[0].text.strip()

    # Step 2: Safety check — SELECT only
    if not is_select_only(sql):
        return AskResponse(
            sql=sql,
            results=[],
            error="Only read queries allowed. The model generated a non-SELECT statement.",
            truncated=False
        )

    # Step 3: Execute against Postgres with timeout and row limit
    try:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()

        # Set hard execution timeout
        cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")

        # Wrap query in row limit
        limited_sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT {MAX_ROWS + 1}"
        cur.execute(limited_sql)

        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()

        # Check if truncated
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]

        results = [dict(zip(columns, row)) for row in rows]
        cur.close()
        conn.close()

        return AskResponse(sql=sql, results=results, error=None, truncated=truncated)

    except Exception as e:
        return AskResponse(
            sql=sql,
            results=[],
            error=str(e),
            truncated=False
        )