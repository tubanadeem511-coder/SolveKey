// SolveKey MCP server: exposes civic tools to any MCP client (Claude Desktop, agents, etc.)
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findNearbyReports, getDepartment, createTicket, searchReports } from "../src/tools.js";
import { REPORT_CATEGORIES } from "../src/report-categories.js";

const server = new McpServer({ name: "SolveKey-tools", version: "0.1.0" });
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
const statuses = ["pending", "reported", "in_progress", "resolved"];

server.tool(
  "find_nearby_reports",
  "Find open reports of the same category within a radius (meters)",
  {
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    category: z.enum(REPORT_CATEGORIES),
    radius_m: z.number().int().min(1).max(5000).optional(),
  },
  async (args) => text(await findNearbyReports(args))
);
server.tool(
  "get_department",
  "Get the responsible department for a category",
  { category: z.enum(REPORT_CATEGORIES) },
  async (args) => text(await getDepartment(args))
);
server.tool(
  "create_ticket",
  "Assign a report to a department and open a ticket",
  { report_id: z.number().int().positive(), department_id: z.number().int().positive() },
  async (args) => text(await createTicket(args))
);
server.tool(
  "search_reports",
  "Search public SolveKey reports by text and optional category/status filters",
  {
    query: z.string().trim().min(1).max(120),
    category: z.enum(REPORT_CATEGORIES).optional(),
    status: z.enum(statuses).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async (args) => text(await searchReports(args))
);

await server.connect(new StdioServerTransport());
