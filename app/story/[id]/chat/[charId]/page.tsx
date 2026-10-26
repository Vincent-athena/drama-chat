"use client";

import { use } from "react";
import ChatWindow from "@/components/ChatWindow";

export default function ChatPage({ params }: { params: Promise<{ id: string; charId: string }> }) {
  const { id, charId } = use(params);
  return <ChatWindow storyId={id} characterId={charId} />;
}
