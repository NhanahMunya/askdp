"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SCHEMA = `CREATE TABLE artist (
  artist_id SERIAL PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE album (
  album_id SERIAL PRIMARY KEY,
  title VARCHAR(160),
  artist_id INT REFERENCES artist
);

CREATE TABLE genre (
  genre_id SERIAL PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE media_type (
  media_type_id SERIAL PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE track (
  track_id SERIAL PRIMARY KEY,
  name VARCHAR(200),
  album_id INT REFERENCES album,
  media_type_id INT REFERENCES media_type,
  genre_id INT REFERENCES genre,
  composer VARCHAR(220),
  milliseconds INT,
  bytes INT,
  unit_price NUMERIC(10,2)
);

CREATE TABLE employee (
  employee_id SERIAL PRIMARY KEY,
  last_name VARCHAR(20),
  first_name VARCHAR(20),
  title VARCHAR(30),
  reports_to INT REFERENCES employee,
  hire_date TIMESTAMP,
  city VARCHAR(40),
  country VARCHAR(40),
  email VARCHAR(60)
);

CREATE TABLE customer (
  customer_id SERIAL PRIMARY KEY,
  first_name VARCHAR(40),
  last_name VARCHAR(20),
  company VARCHAR(80),
  city VARCHAR(40),
  country VARCHAR(40),
  email VARCHAR(60),
  support_rep_id INT REFERENCES employee
);

CREATE TABLE invoice (
  invoice_id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customer,
  invoice_date TIMESTAMP,
  billing_city VARCHAR(40),
  billing_country VARCHAR(40),
  total NUMERIC(10,2)
);

CREATE TABLE invoice_line (
  invoice_line_id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES invoice,
  track_id INT REFERENCES track,
  unit_price NUMERIC(10,2),
  quantity INT
);

CREATE TABLE playlist (
  playlist_id SERIAL PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE playlist_track (
  playlist_id INT REFERENCES playlist,
  track_id INT REFERENCES track
);`;

const SAMPLE_QUESTIONS = [
  "Top 5 customers by spend",
  "Which genre is most popular?",
  "Monthly revenue for 2010",
  "Which employees have the most sales?",
  "Most popular artist by track count",
];

type Message = {
  role: "user" | "assistant";
  question?: string;
  sql?: string;
  results?: Record<string, unknown>[];
  error?: string | null;
  truncated?: boolean;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
    >
      {copied ? "✓ Copied" : "Copy SQL"}
    </button>
  );
}

function LoadingMessage() {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="space-y-2 max-w-3xl">
      <div className="rounded-lg border bg-muted px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <span className="inline-block w-4 text-center">{dots}</span>
        <span>Generating SQL and running query</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleAsk(q?: string) {
    const text = q ?? question;
    if (!text.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", question: text }]);
    setQuestion("");
    setLoading(true);
    setSchemaOpen(false); // close schema drawer on mobile when asking

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          sql: data.sql,
          results: data.results,
          error: data.error,
          truncated: data.truncated,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          error: "Could not reach the API. Is the backend running?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Mobile schema drawer overlay */}
      {schemaOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSchemaOpen(false)}
        />
      )}

      {/* Schema Sidebar */}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-30
          w-72 md:w-80 border-r flex flex-col bg-background
          transform transition-transform duration-300 ease-in-out
          ${schemaOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
            Chinook Schema
          </h2>
          <button
            className="md:hidden text-muted-foreground hover:text-foreground text-lg leading-none"
            onClick={() => setSchemaOpen(false)}
          >
            ✕
          </button>
        </div>
        <pre className="p-4 text-xs overflow-auto flex-1 leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {SCHEMA}
        </pre>
      </aside>

      {/* Main Chat */}
      <main className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="p-3 md:p-4 border-b flex items-center gap-3">
          {/* Schema toggle — mobile only */}
          <button
            className="md:hidden text-muted-foreground hover:text-foreground p-1 rounded"
            onClick={() => setSchemaOpen(true)}
            aria-label="View schema"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <div>
            <h1 className="font-bold text-base md:text-lg leading-tight">
              AskDB
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
              Ask questions about the Chinook music store in plain English
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-3 md:p-4 space-y-6">
          {messages.length === 0 && !loading && (
            <div className="text-center mt-10 md:mt-16 space-y-4 md:space-y-6 px-2">
              <div className="space-y-2">
                <p className="text-3xl">🎵</p>
                <p className="font-medium text-sm md:text-base">
                  Ask anything about the music store
                </p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  Type a question or try one of these:
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleAsk(q)}
                    className="text-xs md:text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 md:px-4 py-2 max-w-[85%] md:max-w-lg text-sm">
                    {msg.question}
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div className="space-y-3 max-w-full md:max-w-3xl">
                  {msg.error ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-destructive/20 text-xs text-destructive font-medium flex items-center gap-1.5">
                        <span>⚠</span> Query Failed
                      </div>
                      {msg.sql && (
                        <div className="border-b border-destructive/10">
                          <div className="px-3 py-1 text-xs text-muted-foreground flex justify-between items-center">
                            <span>Generated SQL</span>
                            <CopyButton text={msg.sql} />
                          </div>
                          <pre className="px-3 pb-3 text-xs font-mono overflow-auto">
                            {msg.sql}
                          </pre>
                        </div>
                      )}
                      <p className="px-3 py-2 text-xs text-destructive font-mono break-words">
                        {msg.error}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border bg-muted overflow-hidden">
                        <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex justify-between items-center">
                          <span className="uppercase tracking-wider">
                            Generated SQL
                          </span>
                          {msg.sql && <CopyButton text={msg.sql} />}
                        </div>
                        <pre className="p-3 text-xs font-mono overflow-auto">
                          {msg.sql}
                        </pre>
                      </div>

                      {msg.results && msg.results.length > 0 && (
                        <div className="rounded-lg border overflow-hidden">
                          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex justify-between items-center">
                            <span className="uppercase tracking-wider">
                              {msg.results.length} row
                              {msg.results.length !== 1 ? "s" : ""}
                            </span>
                            {msg.truncated && (
                              <span className="text-yellow-500 font-medium">
                                ⚠ Truncated to 100 rows
                              </span>
                            )}
                          </div>
                          <div className="overflow-x-auto max-h-64">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {Object.keys(msg.results[0]).map((col) => (
                                    <TableHead
                                      key={col}
                                      className="text-xs font-mono whitespace-nowrap"
                                    >
                                      {col}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {msg.results.map((row, j) => (
                                  <TableRow key={j}>
                                    {Object.values(row).map((val, k) => (
                                      <TableCell
                                        key={k}
                                        className="text-xs font-mono whitespace-nowrap"
                                      >
                                        {String(val)}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {msg.results && msg.results.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No results returned.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && <LoadingMessage />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 md:p-4 border-t space-y-2">
          {messages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  disabled={loading}
                  className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Ask a question..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              disabled={loading}
              className="text-sm"
            />
            <Button
              onClick={() => handleAsk()}
              disabled={loading}
              size="sm"
              className="shrink-0"
            >
              {loading ? "..." : "Ask"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
