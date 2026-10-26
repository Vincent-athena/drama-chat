"use client";

import { use } from "react";
import GroupChatWindow from "@/components/GroupChatWindow";

export default function GroupChatPage({ params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id, groupId } = use(params);
  return <GroupChatWindow storyId={id} groupId={groupId} />;
}
