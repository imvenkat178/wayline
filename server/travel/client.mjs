import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { definitions } from "./schemas.mjs";
import { DomainError } from "../domain/journeys.mjs";
export class TravelClient {
  client = null;
  transport = null;
  connecting = null;
  failures = [];
  closed = false;
  status = { name: "Travel MCP", status: "not checked", lastSuccess: null };
  async connect() {
    if (this.closed) throw new DomainError("Travel service is stopping.", 503);
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.failures = this.failures.filter((at) => Date.now() - at < 60000);
    if (this.failures.length >= 3)
      throw new DomainError(
        "Travel tools are reconnecting. Try again shortly.",
        503,
        "MCP_UNAVAILABLE",
      );
    this.connecting = (async () => {
      const env = { ...getDefaultEnvironment() };
      for (const k of ["ENABLE_EXTERNAL_FEEDS", "OTP_GRAPHQL_URL", "MBTA_API_KEY"])
        if (process.env[k]) env[k] = process.env[k];
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
        env,
        stderr: "pipe",
        maxBufferSize: 6000000,
      });
      const client = new Client({ name: "wayline-backend", version: "2.1.0" });
      this.transport = transport;
      transport.stderr?.on("data", () => {});
      client.onclose = () => {
        if (this.client === client) this.client = null;
        this.failures.push(Date.now());
        this.status = { ...this.status, status: "disconnected" };
      };
      try {
        await client.connect(transport, { timeout: 10000 });
        const listed = await client.listTools();
        for (const name of Object.keys(definitions))
          if (!listed.tools.some((x) => x.name === name)) throw Error("Missing travel tool");
        this.client = client;
        this.status = {
          ...this.status,
          status: "connected",
          lastSuccess: new Date().toISOString(),
        };
        return client;
      } catch {
        this.failures.push(Date.now());
        await transport.close().catch(() => {});
        this.status = { ...this.status, status: "unavailable" };
        throw new DomainError("Travel tools could not connect.", 503, "MCP_UNAVAILABLE");
      }
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  async call(name, args = {}) {
    const definition = Object.hasOwn(definitions, name) ? definitions[name] : null;
    if (!definition) throw new DomainError("Unknown travel tool.", 400);
    const input = definition.input.safeParse(args);
    if (!input.success)
      throw new DomainError(
        "Travel request is incomplete or invalid.",
        400,
        "INVALID_TRAVEL_INPUT",
      );
    const client = await this.connect();
    let result;
    try {
      result = await client.callTool({ name, arguments: input.data }, undefined, {
        timeout: 20000,
      });
    } catch {
      this.status = { ...this.status, status: "unavailable" };
      if (this.client === client) {
        this.client = null;
        this.failures.push(Date.now());
        await client.close().catch(() => {});
      }
      throw new DomainError("Travel service timed out or disconnected.", 503, "MCP_UNAVAILABLE");
    }
    if (result.isError) {
      let detail;
      try {
        detail = JSON.parse(result.content?.find((x) => x.type === "text")?.text);
      } catch {
        /* Use a safe generic provider error for non-JSON failures. */
      }
      throw new DomainError(
        detail?.error ?? "Travel provider unavailable.",
        503,
        detail?.code ?? "UPSTREAM_ERROR",
      );
    }
    const output = definition.output.safeParse(result.structuredContent);
    if (!output.success)
      throw new DomainError(
        "Travel provider returned invalid results.",
        502,
        "INVALID_TOOL_RESULT",
      );
    this.status = { ...this.status, status: "connected", lastSuccess: new Date().toISOString() };
    return output.data;
  }
  async probe() {
    const results = await Promise.allSettled([
      this.call("places", { q: "South Station" }),
      this.call("vehicles"),
      this.call("disruptions"),
      this.call("weather", { lat: 42.352271, lon: -71.055242 }),
      this.call("search", {
        from: "South Station",
        to: "Harvard",
        departure: new Date(Date.now() + 3600000).toISOString(),
        travelers: 1,
        bags: 0,
      }),
    ]);
    const vehicles = results[1];
    const route = results[4];
    const tripId =
      vehicles.status === "fulfilled"
        ? vehicles.value.vehicles.find((v) => v.tripId)?.tripId
        : route.status === "fulfilled"
          ? route.value.journeys.flatMap((j) => j.legs).find((l) => l.tripId)?.tripId
          : null;
    if (tripId) await this.call("predictions", { tripId }).catch(() => {});
    return results.map((r) => r.status);
  }
  async close() {
    this.closed = true;
    await this.connecting?.catch(() => {});
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}
