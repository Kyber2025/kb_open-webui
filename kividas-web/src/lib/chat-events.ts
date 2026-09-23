import { io } from "socket.io-client";

/** Listen before starting generation; saved chats emit to the authenticated user room. */
export async function listenToChat(
  token: string | null,
  chatId: string,
  messageId: string,
  signal: AbortSignal,
  onEvent: (type: string, data: any) => void,
): Promise<() => void> {
  const socket = io({
    path: "/ws/socket.io",
    transports: ["websocket"],
    auth: { token },
    autoConnect: false,
    reconnection: true,
  });
  const close = () => {
    signal.removeEventListener("abort", close);
    socket.removeAllListeners();
    socket.disconnect();
  };
  socket.on("events", (event) => {
    if (event.chat_id === chatId && event.message_id === messageId)
      onEvent(event.data?.type, event.data?.data);
  });
  signal.addEventListener("abort", close, { once: true });
  // A blocked socket must not prevent generation: the HTTP request still runs
  // synchronously and its persisted result is read when it finishes.
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      socket.off("connect", done);
      socket.off("connect_error", done);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    socket.once("connect", done);
    socket.once("connect_error", done);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) { done(); close(); }
    else socket.connect();
  });
  return close;
}
