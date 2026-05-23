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
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const CHINOOK_SCHEMA = `CREATE TABLE artist (
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
  display_columns?: string[];
  chart_hint?: string | null;
  error?: string | null;
  truncated?: boolean;
};

type SessionInfo = {
  session_id: string;
  table_name: string;
  schema_string: string;
  row_count: number;
  column_count: number;
};

//Chart logic

const CHART_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

type ChartType =
  | "bar-horizontal"
  | "bar-vertical"
  | "line"
  | "pie"
  | "scatter"
  | "grouped-bar"
  | null;

function detectChartType(results: Record<string, unknown>[]): ChartType {
  if (!results || results.length === 0) return null;

  const keys = Object.keys(results[0]);
  if (keys.length < 2) return null;

  const isNumeric = (key: string) =>
    results.every((r) => r[key] === null || !isNaN(Number(r[key])));

  const isTimeKey = (key: string) =>
    /month|date|year|day|week|quarter/i.test(key);

  const textCols = keys.filter((k) => !isNumeric(k));
  const numCols = keys.filter((k) => isNumeric(k));

  // All numeric → scatter
  if (textCols.length === 0 && numCols.length === 2) return "scatter";

  // 1 text + 1 numeric
  if (textCols.length === 1 && numCols.length === 1) {
    if (isTimeKey(textCols[0])) return "line";
    if (results.length <= 8) return "pie";
    return "bar-horizontal";
  }

  // 1 text + multiple numeric → grouped bar
  if (textCols.length === 1 && numCols.length > 1) return "grouped-bar";

  // 2 numeric columns
  if (numCols.length === 2 && textCols.length === 0) return "scatter";

  return null;
}

function detectFormat(
  col: string,
): "currency" | "duration_ms" | "date" | "percent" | "number" | "text" {
  const c = col.toLowerCase();
  if (/price|total|revenue|spend|cost|amount|salary/.test(c)) return "currency";
  if (/milliseconds|duration_ms/.test(c)) return "duration_ms";
  if (/date|time|_at|created|updated|hired/.test(c)) return "date";
  if (/percent|pct|rate|ratio/.test(c)) return "percent";
  return "text";
}

function formatCell(value: unknown, col: string): string {
  if (value === null || value === undefined || value === "null") return "—";
  const fmt = detectFormat(col);
  const raw = String(value);

  if (fmt === "currency") {
    const num = parseFloat(raw);
    if (!isNaN(num))
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (fmt === "duration_ms") {
    const ms = parseInt(raw);
    if (!isNaN(ms)) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
  }

  if (fmt === "date") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }

  if (fmt === "percent") {
    const num = parseFloat(raw);
    if (!isNaN(num)) return `${num.toFixed(1)}%`;
  }

  const num = parseFloat(raw);
  if (!isNaN(num) && raw.trim() !== "" && !raw.includes("-")) {
    if (Number.isInteger(num)) return num.toLocaleString("en-US");
    return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  return raw;
}

function ResultBlock({
  results,
  displayColumns,
  chartHint,
  truncated,
}: {
  results: Record<string, unknown>[];
  displayColumns?: string[];
  chartHint?: string | null;
  truncated?: boolean;
}) {
  const [showChart, setShowChart] = useState(true);
  const [showAllColumns, setShowAllColumns] = useState(false);

  const allColumns = Object.keys(results[0]);

  // Use LLM-suggested display columns if available, else show all
  const defaultVisible =
    displayColumns && displayColumns.length > 0
      ? allColumns.filter((col) => displayColumns.includes(col))
      : allColumns;

  const hiddenColumns = allColumns.filter(
    (col) => !defaultVisible.includes(col),
  );

  const visibleColumns = showAllColumns ? allColumns : defaultVisible;
  const hasHiddenColumns = hiddenColumns.length > 0;

  // Map LLM hint to internal chart types
  function mapChartHint(hint: string | null | undefined): ChartType {
    if (!hint) return detectChartType(results);
    if (hint === "bar")
      return results.length <= 8 ? "bar-vertical" : "bar-horizontal";
    if (hint === "line") return "line";
    if (hint === "pie") return "pie";
    if (hint === "scatter") return "scatter";
    return detectChartType(results);
  }

  const resolvedChartType: ChartType = mapChartHint(chartHint);
  const isChartable = resolvedChartType !== null;

  return (
    <div className="space-y-2">
      {/* Chart toggle */}
      {isChartable && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground capitalize">
            {resolvedChartType?.replace(/-/g, " ")} chart
          </span>
          <button
            onClick={() => setShowChart((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            {showChart ? "Hide chart" : "Show chart"}
          </button>
        </div>
      )}

      {/* Chart */}
      {isChartable && showChart && (
        <div className="rounded-lg border bg-background p-3 overflow-x-auto">
          <SmartChart results={results} chartType={resolvedChartType} />
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex justify-between items-center gap-2">
          <span className="uppercase tracking-wider shrink-0">
            {results.length} row{results.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {truncated && (
              <span className="text-yellow-500 font-medium">
                ⚠ Truncated to 100 rows
              </span>
            )}
            {hasHiddenColumns && (
              <button
                onClick={() => setShowAllColumns((v) => !v)}
                className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {showAllColumns
                  ? "Hide extra columns"
                  : `Show all columns (+${hiddenColumns.length} hidden)`}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto max-h-64">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map((col) => (
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
              {results.map((row, j) => (
                <TableRow key={j}>
                  {visibleColumns.map((col, k) => (
                    <TableCell
                      key={k}
                      className="text-xs font-mono whitespace-nowrap"
                    >
                      {formatCell(row[col], col)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function SmartChart({
  results,
  chartType,
}: {
  results: Record<string, unknown>[];
  chartType: ChartType;
}) {
  if (!chartType) return null;

  const keys = Object.keys(results[0]);
  const isNumeric = (key: string) =>
    results.every((r) => r[key] === null || !isNaN(Number(r[key])));

  const textCols = keys.filter((k) => !isNumeric(k));
  const numCols = keys.filter((k) => isNumeric(k));

  const labelKey = textCols[0] ?? keys[0];
  const valueKey = numCols[0] ?? keys[1];

  const data = results.map((r) => ({
    ...r,
    [valueKey]: Number(r[valueKey]),
  }));

  const formatValue = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
  };

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v: number) => formatValue(v)} />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={labelKey}
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={({ name, percent }) =>
              `${name} ${(percent * 100).toFixed(0)}%`
            }
            labelLine={true}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => formatValue(v)} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "bar-horizontal") {
    return (
      <ResponsiveContainer
        width="100%"
        height={Math.max(260, results.length * 36)}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={formatValue}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            width={120}
          />
          <Tooltip formatter={(v: number) => formatValue(v)} />
          <Bar dataKey={valueKey} fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "bar-vertical") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v: number) => formatValue(v)} />
          <Bar dataKey={valueKey} radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "scatter") {
    const xKey = numCols[0];
    const yKey = numCols[1];
    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey={xKey}
            type="number"
            tick={{ fontSize: 11 }}
            name={xKey}
            tickFormatter={formatValue}
          />
          <YAxis
            dataKey={yKey}
            type="number"
            tick={{ fontSize: 11 }}
            name={yKey}
            tickFormatter={formatValue}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={CHART_COLORS[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "grouped-bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v: number) => formatValue(v)} />
          <Legend />
          {numCols.map((col, i) => (
            <Bar
              key={col}
              dataKey={col}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return null;
}

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
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Active schema display — CSV or Chinook
  const activeSchema = session ? session.schema_string : CHINOOK_SCHEMA;
  const activeLabel = session
    ? `${session.table_name} (${session.row_count} rows, ${session.column_count} cols)`
    : "Chinook (default)";

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setSession(data);
      setMessages([]);
    } catch {
      alert("Upload failed. Make sure the file is a valid CSV.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleClearSession() {
    setSession(null);
    setMessages([]);
  }

  async function handleAsk(q?: string) {
    const text = q ?? question;
    if (!text.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", question: text }]);
    setQuestion("");
    setLoading(true);
    setSchemaOpen(false);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          session_id: session?.session_id ?? null,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          sql: data.sql,
          results: data.results,
          display_columns: data.display_columns,
          chart_hint: data.chart_hint,
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
      {/* Mobile overlay */}
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
        {/* Sidebar header */}
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Schema
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]">
              {activeLabel}
            </p>
          </div>
          <button
            className="md:hidden text-muted-foreground hover:text-foreground text-lg leading-none"
            onClick={() => setSchemaOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* Upload / Clear controls */}
        <div className="p-3 border-b space-y-2 shrink-0">
          {!session ? (
            <>
              <p className="text-xs text-muted-foreground">
                Upload a CSV to query your own data. Chinook is used by default.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading..." : "⬆ Upload CSV"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleUpload}
              />
            </>
          ) : (
            <>
              <div className="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2">
                <p className="text-xs text-green-600 font-medium">
                  ✓ CSV loaded
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {session.table_name}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={handleClearSession}
              >
                ✕ Clear — switch to Chinook
              </Button>
            </>
          )}
        </div>

        {/* Schema display */}
        <pre className="p-4 text-xs overflow-auto flex-1 leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {activeSchema}
        </pre>
      </aside>

      {/* Main Chat */}
      <main className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="p-3 md:p-4 border-b flex items-center gap-3">
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
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base md:text-lg leading-tight">
              AskDB
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
              {session
                ? `Querying: ${session.table_name} — ${session.row_count} rows`
                : "Querying: Chinook music store (default)"}
            </p>
          </div>

          {/* Upload button in header for desktop */}
          <div className="hidden md:block shrink-0">
            {!session ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? "Uploading..." : "⬆ Upload CSV"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleClearSession}
              >
                ✕ Clear CSV
              </Button>
            )}
          </div>
        </div>

        {/* Dataset banner */}
        {!session && (
          <div className="px-4 py-2 bg-muted/50 border-b text-xs text-muted-foreground flex items-center gap-2">
            <span>📀</span>
            <span>
              No CSV uploaded — using the{" "}
              <span className="font-medium text-foreground">
                Chinook music store
              </span>{" "}
              database by default.
            </span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-auto p-3 md:p-4 space-y-6">
          {messages.length === 0 && !loading && (
            <div className="text-center mt-10 md:mt-16 space-y-4 md:space-y-6 px-2">
              <div className="space-y-2">
                <p className="text-3xl">{session ? "📊" : "🎵"}</p>
                <p className="font-medium text-sm md:text-base">
                  {session
                    ? `Ask anything about ${session.table_name}`
                    : "Ask anything about the music store"}
                </p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  {session
                    ? `${session.row_count} rows · ${session.column_count} columns loaded`
                    : "Type a question or try one of these:"}
                </p>
              </div>
              {!session && (
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
              )}
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
                        <ResultBlock
                          results={msg.results}
                          displayColumns={msg.display_columns}
                          chartHint={msg.chart_hint}
                          truncated={msg.truncated}
                        />
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
          {messages.length > 0 && !session && (
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
              placeholder={
                session
                  ? `Ask about ${session.table_name}...`
                  : "Ask about the music store..."
              }
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
