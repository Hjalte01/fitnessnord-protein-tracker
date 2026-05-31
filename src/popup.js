const enabledInput = document.getElementById("enabled");
const statusText = document.getElementById("status");

function setStatus(enabled) {
  enabledInput.checked = enabled;
  statusText.textContent = enabled ? "On" : "Off";
}

async function init() {
  const { enabled = true } = await browser.storage.local.get("enabled");
  setStatus(enabled);

  enabledInput.addEventListener("change", async () => {
    const enabled = enabledInput.checked;
    await browser.storage.local.set({ enabled });
    setStatus(enabled);
  });
}

init();
