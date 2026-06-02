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
  if (textCols.length === 0 && numCols.length === 2) return "scatter";
  if (textCols.length === 1 && numCols.length === 1) {
    if (isTimeKey(textCols[0])) return "line";
    if (results.length <= 8) return "pie";
    return "bar-horizontal";
  }
  if (textCols.length === 1 && numCols.length > 1) return "grouped-bar";
  if (numCols.length === 2 && textCols.length === 0) return "scatter";
  return null;
}

function detectFormat(
  col: string,
): "currency" | "duration_ms" | "date" | "percent" | "number" | "text" {
  const c = col.toLowerCase();
  if (
    /^price$|_price$|^total$|_total$|^revenue$|_revenue$|^spend$|_spend$|^cost$|_cost$|^amount$|_amount$|^salary$|_salary$/.test(
      c,
    )
  )
    return "currency";
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
  const defaultVisible =
    displayColumns && displayColumns.length > 0
      ? allColumns.filter((col) => displayColumns.includes(col))
      : allColumns;
  const hiddenColumns = allColumns.filter(
    (col) => !defaultVisible.includes(col),
  );
  const visibleColumns = showAllColumns ? allColumns : defaultVisible;
  const hasHiddenColumns = hiddenColumns.length > 0;

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
      {isChartable && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground capitalize font-medium tracking-wide">
            {resolvedChartType?.replace(/-/g, " ")} chart
          </span>
          <button
            onClick={() => setShowChart((v) => !v)}
            className="text-xs px-3 py-1 rounded-full border border-border/60 hover:bg-muted/80 transition-all text-muted-foreground hover:text-foreground"
          >
            {showChart ? "Hide chart" : "Show chart"}
          </button>
        </div>
      )}

      {isChartable && showChart && (
        <div className="rounded-xl border border-border/60 bg-background/50 p-4 overflow-x-auto shadow-sm">
          <SmartChart results={results} chartType={resolvedChartType} />
        </div>
      )}

      <div className="rounded-xl border border-border/60 overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-border/60 bg-muted/30 text-xs text-muted-foreground flex justify-between items-center gap-2">
          <span className="font-semibold uppercase tracking-widest text-[10px]">
            {results.length} {results.length !== 1 ? "rows" : "row"}
          </span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {truncated && (
              <span className="text-amber-500 font-medium flex items-center gap-1">
                <span>⚠</span> Truncated to 100 rows
              </span>
            )}
            {hasHiddenColumns && (
              <button
                onClick={() => setShowAllColumns((v) => !v)}
                className="text-xs px-3 py-0.5 rounded-full border border-border/60 hover:bg-muted/80 transition-all text-muted-foreground hover:text-foreground"
              >
                {showAllColumns
                  ? "Hide extra columns"
                  : `+${hiddenColumns.length} hidden`}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto max-h-64">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-muted/20">
                {visibleColumns.map((col) => (
                  <TableHead
                    key={col}
                    className="text-[11px] font-semibold font-mono uppercase tracking-wider text-muted-foreground whitespace-nowrap py-2"
                  >
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row, j) => (
                <TableRow
                  key={j}
                  className={j % 2 === 0 ? "bg-background" : "bg-muted/10"}
                >
                  {visibleColumns.map((col, k) => (
                    <TableCell
                      key={k}
                      className="text-xs font-mono whitespace-nowrap py-2"
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
  const data = results.map((r) => ({ ...r, [valueKey]: Number(r[valueKey]) }));
  const formatValue = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
  };

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.5}
          />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v) => formatValue(Number(v))} />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={CHART_COLORS[0]}
            strokeWidth={2.5}
            dot={{ r: 3, fill: CHART_COLORS[0] }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={labelKey}
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={({ name, percent }) =>
              `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatValue(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "bar-horizontal") {
    return (
      <ResponsiveContainer
        width="100%"
        height={Math.max(240, results.length * 36)}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.5}
          />
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
          <Tooltip formatter={(v) => formatValue(Number(v))} />
          <Bar dataKey={valueKey} radius={[0, 6, 6, 0]}>
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
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.5}
          />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v) => formatValue(Number(v))} />
          <Bar dataKey={valueKey} radius={[6, 6, 0, 0]}>
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
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.5}
          />
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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.5}
          />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
          <Tooltip formatter={(v) => formatValue(Number(v))} />
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
      className="text-xs px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-all text-zinc-400 hover:text-zinc-200 font-mono"
    >
      {copied ? "✓ copied" : "copy"}
    </button>
  );
}

function LoadingMessage() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-start gap-3 max-w-3xl">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 mt-0.5 shadow-md">
        <span className="text-white text-xs font-bold">AI</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2 shadow-sm">
        <span className="flex gap-0.5">
          {[1, 2, 3].map((d) => (
            <span
              key={d}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${dots >= d ? "bg-indigo-400" : "bg-muted-foreground/30"}`}
            />
          ))}
        </span>
        <span className="text-xs">Generating SQL and running query</span>
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

  const activeSchema = session ? session.schema_string : CHINOOK_SCHEMA;
  const activeLabel = session
    ? `${session.table_name} · ${session.row_count} rows`
    : "Chinook · default";

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

    const history = messages
      .reduce<{ question: string; sql: string }[]>((acc, msg, i, arr) => {
        if (
          msg.role === "user" &&
          arr[i + 1]?.role === "assistant" &&
          arr[i + 1]?.sql
        ) {
          acc.push({ question: msg.question ?? "", sql: arr[i + 1].sql ?? "" });
        }
        return acc;
      }, [])
      .slice(-4);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          session_id: session?.session_id ?? null,
          history,
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
          className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setSchemaOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
        fixed md:static inset-y-0 left-0 z-30
        w-72 md:w-76 border-r border-border/60 flex flex-col bg-background
        transform transition-transform duration-300 ease-in-out
        ${schemaOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        {/* Sidebar top */}
        <div className="p-4 border-b border-border/60 flex items-start justify-between shrink-0">
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Schema
            </p>
            <p className="text-xs text-foreground/70 font-mono truncate max-w-[190px]">
              {activeLabel}
            </p>
          </div>
          <button
            className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSchemaOpen(false)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Upload controls */}
        <div className="p-3 border-b border-border/60 space-y-2 shrink-0">
          {!session ? (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Upload a CSV to query your own data. Chinook is used by default.
              </p>
              <button
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg border border-dashed border-border hover:border-indigo-400/60 hover:bg-indigo-500/5 transition-all text-muted-foreground hover:text-indigo-400 disabled:opacity-50"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {uploading ? "Uploading…" : "Upload CSV"}
              </button>
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
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    CSV loaded
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {session.table_name}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClearSession}
                className="w-full flex items-center justify-center gap-2 text-xs py-1.5 rounded-lg border border-border/60 hover:bg-muted/60 transition-all text-muted-foreground hover:text-foreground"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Clear — switch to Chinook
              </button>
            </>
          )}
        </div>

        {/* Schema text */}
        <pre className="p-4 text-[11px] overflow-auto flex-1 leading-relaxed text-muted-foreground/70 whitespace-pre-wrap font-mono">
          {activeSchema}
        </pre>
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="border-b border-border/60 bg-background/95 backdrop-blur-sm shrink-0">
          <div className="px-3 md:px-5 py-3 flex items-center gap-3">
            <button
              className="md:hidden text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/60 transition-all"
              onClick={() => setSchemaOpen(true)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
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

            {/* Logo */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-md">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-sm md:text-base leading-tight tracking-tight">
                  AskDB
                </h1>
                <p className="text-[11px] text-muted-foreground hidden sm:block truncate">
                  {session
                    ? `${session.table_name} · ${session.row_count.toLocaleString()} rows`
                    : "Chinook music store · default"}
                </p>
              </div>
            </div>

            {/* Desktop upload */}
            <div className="hidden md:block shrink-0">
              {!session ? (
                <>
                  <button
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted/60 transition-all text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    {uploading ? "Uploading…" : "Upload CSV"}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleClearSession}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted/60 transition-all text-muted-foreground hover:text-foreground"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  Clear CSV
                </button>
              )}
            </div>
          </div>

          {/* Dataset banner */}
          {!session && (
            <div className="px-4 md:px-5 py-1.5 bg-indigo-500/5 border-t border-indigo-500/10 text-[11px] text-muted-foreground flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
              <span>
                No CSV uploaded — using{" "}
                <span className="font-semibold text-foreground/80">
                  Chinook music store
                </span>{" "}
                by default
              </span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-3 md:px-5 py-6 space-y-6">
          {/* Empty state */}
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 pb-16">
              <div className="space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/20">
                  {session ? (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M3 9h18M9 21V9" />
                    </svg>
                  ) : (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                    >
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-base md:text-lg">
                    {session
                      ? `Ask anything about ${session.table_name}`
                      : "Ask anything about the music store"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {session
                      ? `${session.row_count.toLocaleString()} rows · ${session.column_count} columns ready`
                      : "Type a question in plain English — no SQL needed"}
                  </p>
                </div>
              </div>

              {!session && (
                <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                  {SAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleAsk(q)}
                      className="text-xs px-3.5 py-1.5 rounded-full border border-border/70 hover:border-indigo-400/50 hover:bg-indigo-500/5 hover:text-indigo-500 transition-all text-muted-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div key={i}>
              {/* User bubble */}
              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] md:max-w-lg text-sm leading-relaxed shadow-md shadow-indigo-500/20">
                    {msg.question}
                  </div>
                </div>
              )}

              {/* Assistant response */}
              {msg.role === "assistant" && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 mt-0.5 shadow-md">
                    <span className="text-white text-[10px] font-bold">AI</span>
                  </div>

                  <div className="space-y-3 flex-1 min-w-0 max-w-3xl">
                    {msg.error ? (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
                        <div className="px-4 py-2 border-b border-red-500/10 text-xs text-red-500 font-semibold flex items-center gap-2">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          Query Failed
                        </div>
                        {msg.sql && (
                          <div className="bg-zinc-950 border-b border-red-500/10">
                            <div className="px-4 py-1.5 flex justify-between items-center border-b border-white/5">
                              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                                sql
                              </span>
                              <CopyButton text={msg.sql} />
                            </div>
                            <pre className="px-4 py-3 text-xs font-mono text-zinc-300 overflow-auto leading-relaxed">
                              {msg.sql}
                            </pre>
                          </div>
                        )}
                        <p className="px-4 py-3 text-xs text-red-500 font-mono break-words leading-relaxed">
                          {msg.error}
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* SQL block — dark editor style */}
                        <div className="rounded-xl overflow-hidden border border-border/40 shadow-sm">
                          <div className="bg-zinc-950 border-b border-white/5 px-4 py-2 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1">
                                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                              </div>
                              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider ml-1">
                                generated sql
                              </span>
                            </div>
                            {msg.sql && <CopyButton text={msg.sql} />}
                          </div>
                          <pre className="bg-zinc-950 px-4 py-4 text-xs font-mono text-emerald-300/90 overflow-auto leading-relaxed">
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
                          <p className="text-sm text-muted-foreground italic">
                            No results returned.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && <LoadingMessage />}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-sm px-3 md:px-5 py-3 space-y-2.5 shrink-0">
          {/* Sample chips — only when Chinook and has messages */}
          {messages.length > 0 && !session && (
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  disabled={loading}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 hover:border-indigo-400/50 hover:bg-indigo-500/5 hover:text-indigo-500 transition-all text-muted-foreground disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <Input
              placeholder={
                session
                  ? `Ask about ${session.table_name}…`
                  : "Ask about the music store…"
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              disabled={loading}
              className="text-sm rounded-xl border-border/60 bg-muted/20 focus:bg-background transition-colors h-10"
            />
            <Button
              onClick={() => handleAsk()}
              disabled={loading}
              className="rounded-xl h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 shadow-sm transition-all"
              size="sm"
            >
              {loading ? (
                <svg
                  className="animate-spin"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.3" />
                  <path d="M21 12a9 9 0 00-9-9" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
