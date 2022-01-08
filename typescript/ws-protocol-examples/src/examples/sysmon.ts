import { FoxgloveServer } from "@foxglove/ws-protocol";
import { Command } from "commander";
import Debug from "debug";
import { WebSocketServer } from "ws";

import boxen from "../boxen";
import fetch from "../fetch";
import ISSUE_SCHEMA from "./issue.schema.json";

const log = Debug("foxglove:sysmon");
Debug.enable("foxglove:*");

// eslint-disable-next-line @typescript-eslint/promise-function-async
function delay(durationSec: number) {
  return new Promise((resolve) => setTimeout(resolve, durationSec * 1000));
}

type Issue = {
  id: string;
};

async function getIssues(): Promise<Issue[]> {
  const READ_TOKEN = "4424ab8b916f46cea70659116b26267ba69726c2ae7b4f2c8d8e3b3692bc053e";
  const ORG_SLUG = "foxglove";
  const PROJECT_SLUG = "studio";
  // const PROJECT_ID = "5649767"; // Studio

  //   curl https://sentry.io/api/0/projects/foxglove/studio/issues/ \
  //    -H 'Authorization: Bearer 4424ab8b916f46cea70659116b26267ba69726c2ae7b4f2c8d8e3b3692bc053e'

  try {
    const url = `https://sentry.io/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/issues/`;
    log(`fetching ${url}`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    });

    try {
      const json = (await res.json()) as unknown;
      return json as Issue[];
    } catch (jsonErr) {
      log(`Failed to parse Sentry API response: ${jsonErr as string}`);
    }
  } catch (err) {
    log(`Failed to fetch issues from Sentry API: ${err as string}`);
    return [];
  }
  return [];
}

// type Stats = {
//   hostname: string;
//   platform: string;
//   type: string;
//   arch: string;
//   version: string;
//   release: string;
//   endianness: string;
//   uptime: number;
//   freemem: number;
//   totalmem: number;
//   cpus: (os.CpuInfo & { usage: number })[];
//   total_cpu_usage: number;
//   loadavg: number[];
//   networkInterfaces: (os.NetworkInterfaceInfo & { name: string })[];
// };
// function getStats(prevStats: Stats | undefined): Stats {
//   let cpuTotal = 0;
//   let idleTotal = 0;
//   const cpus: Stats["cpus"] = [];
//   os.cpus().forEach((cpu, i) => {
//     const total = cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
//     let usage = 0;
//     const prevTimes = prevStats?.cpus[i]?.times;
//     if (prevTimes) {
//       const prevTotal =
//         prevTimes.idle + prevTimes.user + prevTimes.nice + prevTimes.sys + prevTimes.irq;
//       cpuTotal += total - prevTotal;
//       idleTotal += cpu.times.idle - prevTimes.idle;
//       usage = 1 - (cpu.times.idle - prevTimes.idle) / (total - prevTotal);
//     }
//     cpus.push({ ...cpu, usage });
//   });
//   const networkInterfaces: Stats["networkInterfaces"] = [];
//   for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
//     if (ifaces) {
//       networkInterfaces.push(...ifaces.map((iface) => ({ name, ...iface })));
//     }
//   }
//   return {
//     hostname: os.hostname(),
//     platform: os.platform(),
//     type: os.type(),
//     arch: os.arch(),
//     version: os.version(),
//     release: os.release(),
//     endianness: os.endianness(),
//     uptime: os.uptime(),
//     freemem: os.freemem(),
//     totalmem: os.totalmem(),
//     cpus,
//     total_cpu_usage: 1 - idleTotal / cpuTotal,
//     loadavg: os.loadavg(),
//     networkInterfaces,
//   };
// }

async function main() {
  const server = new FoxgloveServer({ name: "sentry" });
  const port = 8765;
  const ws = new WebSocketServer({
    port,
    handleProtocols: (protocols) => server.handleProtocols(protocols),
  });
  ws.on("listening", () => {
    void boxen(
      `📡 Server listening on localhost:${port}. To see data, visit:\n` +
        `https://studio.foxglove.dev/?ds=foxglove-websocket&ds.url=ws://localhost:${port}/`,
      { borderStyle: "round", padding: 1 },
    ).then(log);
  });
  ws.on("connection", (conn, req) => {
    const name = `${req.socket.remoteAddress!}:${req.socket.remotePort!}`;
    server.handleConnection(conn, name);
  });

  const ch1 = server.addChannel({
    topic: "issues",
    encoding: "json",
    schemaName: "Issue",
    schema: JSON.stringify(ISSUE_SCHEMA),
  });

  const textEncoder = new TextEncoder();
  const INTERVAL_SEC = 5;
  const REFRESH_SEC = 60;
  let controller: AbortController | undefined;

  server.on("subscribe", (_chanId) => {
    log("starting monitor");
    if (controller) {
      controller.abort();
      throw new Error("already running");
    }
    controller = new AbortController();
    void (async function (signal) {
      let issues: Issue[] = [];
      let lastSync = 0n;
      while (!signal.aborted) {
        const now = BigInt(Date.now()) * 1_000_000n;
        if (now - lastSync > BigInt(REFRESH_SEC) * 1_000_000n) {
          lastSync = now;
          issues = await getIssues();
        }
        log(`sending ${issues.length} issues`);
        server.sendMessage(ch1, now, textEncoder.encode(JSON.stringify({ issues })));
        await delay(INTERVAL_SEC);
      }
    })(controller.signal);
  });
  server.on("unsubscribe", (_chanId) => {
    log("stopping monitor");
    controller?.abort();
    controller = undefined;
  });
  server.on("error", (err) => {
    log("server error: %o", err);
  });
}

export default new Command("sentry").description("publish Foxglove Sentry issues").action(main);
