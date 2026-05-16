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

type Message = {
  role: "user" | "assistant";
  question?: string;
  sql?: string;
  results?: Record<string, unknown>[];
  error?: string | null;
  truncated?: boolean;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleAsk() {
    if (!question.trim() || loading) return;

    const userMessage: Message = { role: "user", question };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
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
        { role: "assistant", error: "Could not reach the API." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left: Schema Viewer */}
      <aside className="w-80 border-r flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
            Chinook Schema
          </h2>
        </div>
        <pre className="p-4 text-xs overflow-auto flex-1 leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {SCHEMA}
        </pre>
      </aside>

      {/* Right: Chat */}
      <main className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="p-4 border-b">
          <h1 className="font-bold text-lg">AskDB</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions about the Chinook music store in plain English
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-20 space-y-2">
              <p className="text-2xl">🎵</p>
              <p className="font-medium">Ask anything about the music store</p>
              <p className="text-sm">
                Try: &quot;Who are the top 5 artists by number of tracks?&quot;
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 max-w-lg text-sm">
                    {msg.question}
                  </div>
                </div>
              )}

              {msg.role === "assistant" && (
                <div className="space-y-3 max-w-3xl">
                  {msg.error ? (
                    <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                      {msg.error}
                    </div>
                  ) : (
                    <>
                      {/* SQL block */}
                      <div className="rounded-lg border bg-muted overflow-hidden">
                        <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-mono uppercase tracking-wider">
                          Generated SQL
                        </div>
                        <pre className="p-3 text-xs font-mono overflow-auto">
                          {msg.sql}
                        </pre>
                      </div>

                      {/* Results table */}
                      {msg.results && msg.results.length > 0 && (
                        <div className="rounded-lg border overflow-hidden">
                          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground uppercase tracking-wider flex justify-between">
                            <span>
                              {msg.results.length} row
                              {msg.results.length !== 1 ? "s" : ""}
                            </span>
                            {msg.truncated && (
                              <span className="text-yellow-500 font-medium">
                                ⚠ Truncated to 100 rows
                              </span>
                            )}
                          </div>
                          <div className="overflow-auto max-h-64">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {Object.keys(msg.results[0]).map((col) => (
                                    <TableHead
                                      key={col}
                                      className="text-xs font-mono"
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
                                        className="text-xs font-mono"
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
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              placeholder="Ask a question about the music store..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              disabled={loading}
            />
            <Button onClick={handleAsk} disabled={loading}>
              {loading ? "Thinking..." : "Ask"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
