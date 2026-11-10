/** The line the browser puts in front of a message when the player shows an item. Isomorphic. */
export const showItemLine = (i: { emoji: string; name: string }) => `*shows ${i.emoji} ${i.name}*`;
