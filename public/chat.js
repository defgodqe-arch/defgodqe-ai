const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

let chatHistory = [];
let isProcessing = false;

function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  const p = document.createElement("p");
  p.textContent = content;
  messageEl.appendChild(p);
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
  const events = [];
  let normalized = buffer.replace(/\r/g, "");
  let end;
  while ((end = normalized.indexOf("\n\n")) !== -1) {
    const raw = normalized.slice(0, end);
    normalized = normalized.slice(end + 2);
    const data = raw.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (data) events.push(data);
  }
  return { events, buffer: normalized };
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  addMessageToChat("user", message);
  userInput.value = "";
  userInput.style.height = "auto";
  typingIndicator?.classList.add("visible");

  chatHistory.push({ role: "user", content: message });

  try {
    const response = await fetch("/chat?stream=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Defgodqe-Client": "web"
      },
      body: JSON.stringify({ messages: chatHistory })
    });

    if (!response.ok) {
      let detail = `Request failed (${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData?.error) detail = errorData.error;
      } catch {}
      throw new Error(detail);
    }

    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    const assistantTextEl = document.createElement("p");
    assistantMessageEl.appendChild(assistantTextEl);
    chatMessages.appendChild(assistantMessageEl);

    let responseText = "";
    const contentType = response.headers.get("content-type") || "";

    if (response.body && contentType.includes("text/event-stream")) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parsed = consumeSseEvents(buffer);
        buffer = parsed.buffer;

        for (const data of parsed.events) {
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          try {
            const parsedData = JSON.parse(data);
            const chunk = typeof parsedData.response === "string"
              ? parsedData.response
              : parsedData.choices?.[0]?.delta?.content || "";
            if (chunk) {
              responseText += chunk;
              assistantTextEl.textContent = responseText;
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          } catch {}
        }
        if (done) break;
      }
    } else {
      const data = await response.json();
      responseText = data.response || data.error || "No response received.";
      assistantTextEl.textContent = responseText;
    }

    if (!responseText) {
      assistantTextEl.textContent = "The AI returned an empty response. Please try again.";
      responseText = assistantTextEl.textContent;
    }

    chatHistory.push({ role: "assistant", content: responseText });
  } catch (error) {
    console.error("defgodqe chat error:", error);
    addMessageToChat("assistant", `I couldn't connect to defgodqe. ${error.message || "Please try again."}`);
  } finally {
    typingIndicator?.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 180) + "px";
});

userInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

addMessageToChat("assistant", "Hey! I'm defgodqe. What are we building today?");
