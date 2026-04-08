import { describe, it, expect, beforeEach } from "vitest";
import { formatMessage, renderMessage } from "../js/chat.js";

describe("formatMessage", () => {
  const user = { name: "David", color: "#ef4444" };

  it("creates a message with all fields", () => {
    const msg = formatMessage(user, "Hola mundo", true);
    expect(msg.name).toBe("David");
    expect(msg.color).toBe("#ef4444");
    expect(msg.text).toBe("Hola mundo");
    expect(msg.isFinal).toBe(true);
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it("marks interim messages correctly", () => {
    const msg = formatMessage(user, "Hola...", false);
    expect(msg.isFinal).toBe(false);
  });
});

describe("renderMessage", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("renders a final message", () => {
    const msg = {
      name: "David",
      color: "#ef4444",
      text: "Hola mundo",
      isFinal: true,
      timestamp: Date.now(),
    };

    renderMessage(container, msg);

    const messageDiv = container.querySelector(".chat-message");
    expect(messageDiv).not.toBeNull();
    expect(messageDiv.classList.contains("interim")).toBe(false);

    const nameSpan = messageDiv.querySelector(".chat-name");
    expect(nameSpan.textContent).toBe("David: ");
    expect(nameSpan.style.color).toBe("rgb(239, 68, 68)");

    const textSpan = messageDiv.querySelector(".chat-text");
    expect(textSpan.textContent).toBe("Hola mundo");
  });

  it("renders an interim message with interim class", () => {
    const msg = {
      name: "David",
      color: "#ef4444",
      text: "Hola...",
      isFinal: false,
      timestamp: Date.now(),
    };

    renderMessage(container, msg);

    const messageDiv = container.querySelector(".chat-message");
    expect(messageDiv.classList.contains("interim")).toBe(true);
  });

  it("appends multiple messages in order", () => {
    renderMessage(container, { name: "A", color: "#fff", text: "First", isFinal: true, timestamp: 1 });
    renderMessage(container, { name: "B", color: "#000", text: "Second", isFinal: true, timestamp: 2 });

    const messages = container.querySelectorAll(".chat-message");
    expect(messages.length).toBe(2);
    expect(messages[0].querySelector(".chat-text").textContent).toBe("First");
    expect(messages[1].querySelector(".chat-text").textContent).toBe("Second");
  });
});
