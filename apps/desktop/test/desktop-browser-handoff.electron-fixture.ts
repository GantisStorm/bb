import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createServer } from "node:http";
import { app, BrowserWindow } from "electron";
import WebSocket from "ws";
import { z } from "zod";
import { createDesktopBrowserBroker } from "../src/desktop-browser-broker.js";
import { createDesktopBrowserViewManager } from "../src/desktop-browser-view.js";

const deadline = setTimeout(() => app.exit(1), 30_000);
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(
    "<title>Handoff</title><button onclick=\"this.textContent='clicked'\">Ready</button>",
  );
});

async function run() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  await app.whenReady();
  const window = new BrowserWindow({ show: false });
  await window.loadURL("about:blank");
  const manager = createDesktopBrowserViewManager({
    partition: `bb-handoff-${Date.now()}`,
    dispatchAppCommand: () => {},
    focusHostWebContents: () => {
      throw new Error("Hidden automation stole focus");
    },
    resolveAppCommand: () => null,
  });
  const broker = createDesktopBrowserBroker({ manager, product: "BB/Handoff" });
  broker.registerWindow(window);
  broker.setHostId("host-test");
  const target = broker.getTarget(window.webContents.id);
  assert(target);
  const scope = {
    instanceId: target.instanceId,
    generation: target.generation,
    threadId: "thread-test",
  };
  let socket: WebSocket | undefined;
  try {
    await broker.execute({
      type: "desktop.browser.create_tab",
      ...scope,
      tabId: "probe",
      url: `http://127.0.0.1:${address.port}/`,
      profile: { kind: "personal" },
      presentation: "hidden",
    });
    const [native] = manager.getAutomationTabs({
      hostWebContentsId: window.webContents.id,
      threadId: scope.threadId,
    });
    assert(native);
    await once(native.webContents, "did-finish-load");
    const epoch = () => {
      const [tab] = manager.listTabs({
        hostWebContentsId: window.webContents.id,
        threadId: scope.threadId,
      });
      assert(tab);
      assert(tab.navigationEpoch !== undefined);
      return tab.navigationEpoch;
    };
    const script = () =>
      manager.runPageScript({
        hostWindow: window,
        request: {
          tabId: "probe",
          requestId: crypto.randomUUID(),
          expectedNavigationEpoch: epoch(),
          world: "main",
          source: '() => document.querySelector("button").textContent',
          input: null,
          timeoutMs: 3_000,
        },
      });
    assert.equal((await script()).value, "Ready");
    await broker.execute({
      type: "desktop.browser.acquire_control",
      ...scope,
      leaseId: "lease-test",
      tabIds: ["probe"],
      controllerLabel: "Handoff test",
      expiresAt: Date.now() + 20_000,
    });
    const connection = await broker.execute({
      type: "desktop.browser.open_connection",
      ...scope,
      leaseId: "lease-test",
      tabIds: ["probe"],
    });
    assert("wsEndpoint" in connection);
    socket = new WebSocket(connection.wsEndpoint);
    await once(socket, "open");
    let sequence = 0;
    const pending = new Map<
      number,
      PromiseWithResolvers<Record<string, unknown>>
    >();
    socket.on("message", (raw) => {
      const message = z
        .object({
          id: z.number().optional(),
          result: z.record(z.string(), z.unknown()).optional(),
          error: z.object({ message: z.string() }).optional(),
        })
        .parse(JSON.parse(raw.toString()));
      if (message.id === undefined) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
    });
    const command = (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ) => {
      const request = Promise.withResolvers<Record<string, unknown>>();
      const id = ++sequence;
      pending.set(id, request);
      socket?.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
      return request.promise;
    };
    const targets = z
      .object({
        targetInfos: z.array(
          z.object({ targetId: z.string(), title: z.string() }),
        ),
      })
      .parse(await command("Target.getTargets", {}));
    const pageTarget = targets.targetInfos.find(
      (entry) => entry.title === "Handoff",
    );
    assert(pageTarget);
    const attached = z
      .object({ sessionId: z.string() })
      .parse(
        await command("Target.attachToTarget", {
          targetId: pageTarget.targetId,
          flatten: true,
        }),
      );
    await assert.rejects(script(), Error);
    await command(
      "Runtime.evaluate",
      {
        expression: 'document.querySelector("button").click()',
        returnByValue: true,
      },
      attached.sessionId,
    );
    const evaluated = z
      .object({ result: z.object({ value: z.string() }) })
      .parse(
        await command(
          "Runtime.evaluate",
          {
            expression: 'document.querySelector("button").textContent',
            returnByValue: true,
          },
          attached.sessionId,
        ),
      );
    assert.equal(evaluated.result.value, "clicked");
    const detached = once(native.webContents.debugger, "detach");
    await broker.execute({
      type: "desktop.browser.release_control",
      ...scope,
      leaseId: "lease-test",
    });
    await detached;
    assert.equal((await script()).value, "clicked");
    assert.equal(
      broker.getControl(window.webContents.id, "probe")?.control,
      null,
    );
    assert.equal(window.isVisible(), false);
    console.log(JSON.stringify({ nativeHandoff: "passed" }));
  } finally {
    socket?.terminate();
    broker.dispose();
    manager.destroyAll();
    window.destroy();
    server.close();
    clearTimeout(deadline);
  }
}
run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
