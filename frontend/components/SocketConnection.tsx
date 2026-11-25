"use client";

import { useEffect } from "react";
import { socket } from "../lib/socket";

export function SocketConnection() {
  useEffect(() => {
    socket.connect();
    const onError = (error: Error) => console.error("SolveKey realtime connection failed", error);
    socket.on("connect_error", onError);
    return () => {
      socket.off("connect_error", onError);
      socket.disconnect();
    };
  }, []);

  return null;
}
