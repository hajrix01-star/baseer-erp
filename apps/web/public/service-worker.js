// Attendance remains online-only by policy. This worker never queues or fabricates a time record.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
