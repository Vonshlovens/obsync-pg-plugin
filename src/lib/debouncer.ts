import { EventType, FileEvent } from './types';

interface PendingEvent {
  event: FileEvent;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Debouncer collects and coalesces rapid file events
 */
export class Debouncer {
  private delay: number;
  private events: Map<string, PendingEvent> = new Map();
  private callbacks: ((event: FileEvent) => void)[] = [];
  private stopped = false;

  constructor(delayMs: number) {
    this.delay = delayMs;
  }

  /**
   * Register a callback for debounced events
   */
  onEvent(callback: (event: FileEvent) => void): void {
    this.callbacks.push(callback);
  }

  /**
   * Add a new event to be debounced
   */
  add(path: string, eventType: EventType): void {
    if (this.stopped) return;

    const event: FileEvent = {
      path,
      eventType,
      timestamp: new Date(),
    };

    const existing = this.events.get(path);

    if (existing) {
      // Stop existing timer
      clearTimeout(existing.timer);

      // Coalesce event types
      // DELETE always wins (file is gone)
      // CREATE + MODIFY = CREATE (new file modified)
      // MODIFY + MODIFY = MODIFY
      if (eventType === EventType.Delete) {
        existing.event.eventType = EventType.Delete;
      } else if (existing.event.eventType === EventType.Create && eventType === EventType.Modify) {
        // Keep as CREATE
      } else if (existing.event.eventType !== EventType.Delete) {
        existing.event.eventType = eventType;
      }
      existing.event.timestamp = event.timestamp;

      // Reset timer
      existing.timer = setTimeout(() => this.emit(path), this.delay);
    } else {
      // New event
      this.events.set(path, {
        event,
        timer: setTimeout(() => this.emit(path), this.delay),
      });
    }
  }

  /**
   * Emit an event to all callbacks
   */
  private emit(path: string): void {
    const pending = this.events.get(path);
    if (!pending) return;

    this.events.delete(path);

    for (const callback of this.callbacks) {
      try {
        callback(pending.event);
      } catch (error) {
        console.error('Error in debouncer callback:', error);
      }
    }
  }

  /**
   * Flush all pending events immediately
   */
  flush(): void {
    const paths = Array.from(this.events.keys());
    for (const path of paths) {
      const pending = this.events.get(path);
      if (pending) {
        clearTimeout(pending.timer);
        this.emit(path);
      }
    }
  }

  /**
   * Stop the debouncer and clear all pending events
   */
  stop(): void {
    this.stopped = true;
    for (const pending of this.events.values()) {
      clearTimeout(pending.timer);
    }
    this.events.clear();
  }

  /**
   * Get count of pending events
   */
  pendingCount(): number {
    return this.events.size;
  }
}
