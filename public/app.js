const chat = document.getElementById("chat");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("send");

const appendMessage = (content, role) => {
  const el = document.createElement("article");
  el.className = `msg ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
};

const setPending = (isPending) => {
  sendBtn.disabled = isPending;
  promptInput.disabled = isPending;
};

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = promptInput.value.trim();

  if (!message) {
    return;
  }

  appendMessage(message, "user");
  promptInput.value = "";
  promptInput.style.height = "auto";

  const pending = appendMessage("Thinking…", "assistant");
  setPending(true);

  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Something went wrong.");
    }

    pending.textContent = payload.reply || "(No response body)";
  } catch (error) {
    pending.textContent = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
  } finally {
    setPending(false);
    promptInput.focus();
  }
});

appendMessage("Hi — I’m ready. Ask me anything.", "assistant");
