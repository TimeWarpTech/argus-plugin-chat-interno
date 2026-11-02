/** Short-lived activity only: message text never enters this registry or its events. */
export const TYPING_TTL_MS = 6000;

export class TypingRegistry {
  private readonly rooms = new Map<string, Map<string, number>>();

  private sweep(now: number) {
    for (const [id, people] of this.rooms) {
      for (const [userId, until] of people) if (until <= now) people.delete(userId);
      if (people.size === 0) this.rooms.delete(id);
    }
  }

  set(conversationId: string, userId: string, active: boolean, now = Date.now()): number {
    this.sweep(now);
    if (!active) {
      this.rooms.get(conversationId)?.delete(userId);
      if (this.rooms.get(conversationId)?.size === 0) this.rooms.delete(conversationId);
      return now;
    }
    const people = this.rooms.get(conversationId) ?? new Map<string, number>();
    const expiresAt = now + TYPING_TTL_MS;
    people.set(userId, expiresAt);
    this.rooms.set(conversationId, people);
    return expiresAt;
  }

  list(conversationId: string, now = Date.now()) {
    this.sweep(now);
    return [...(this.rooms.get(conversationId) ?? [])].map(([userId, expiresAt]) => ({ userId, expiresAt }));
  }
}
