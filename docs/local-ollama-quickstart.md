# Local Ollama Quickstart

CrawlForge uses Ollama as the **default LLM provider** for `extract_with_llm` and `extract_structured`. No API keys required — everything runs locally.

---

## 1. Install Ollama

### macOS
```bash
brew install ollama
```

Or download from https://ollama.com

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Windows
Download the installer from https://ollama.com/download/windows

---

## 2. Start the Ollama Server

```bash
ollama serve
```

Ollama listens on `http://localhost:11434` by default. Keep this terminal open (or run as a background service).

---

## 3. Pull a Model

```bash
# Recommended: small and fast
ollama pull llama3.2:3b

# Better quality for complex extraction
ollama pull llama3.1:8b

# Lightweight — good for low-RAM machines
ollama pull mistral:7b
```

Verify models are available:
```bash
ollama list
```

Or via CrawlForge:
```json
{
  "tool": "list_ollama_models"
}
```

---

## 4. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.2:3b` | Default model for `extract_with_llm` |
| `OLLAMA_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |

Set in `.env` or export before starting CrawlForge:
```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3.1:8b
```

---

## 5. LLM Fallback Chain

CrawlForge tries providers in this order for `extract_with_llm` and `extract_structured`:

1. **Ollama** (local) — always tried first
2. **OpenAI** — if `OPENAI_API_KEY` is set
3. **Anthropic** — if `ANTHROPIC_API_KEY` is set
4. **MCP Sampling** — if connected MCP client supports sampling
5. **CSS selector fallback** — for `extract_structured` only

---

## 6. Model Selection Guide

| Model | RAM Required | Best For |
|-------|-------------|----------|
| `llama3.2:3b` | 4 GB | Fast extraction, structured JSON |
| `llama3.1:8b` | 8 GB | Complex schemas, reasoning |
| `mistral:7b` | 8 GB | Multilingual content |
| `phi3:mini` | 3 GB | Ultra-fast, simple tasks |
| `gemma2:9b` | 10 GB | High-quality summarization |

---

## 7. Troubleshooting

**"Could not reach Ollama"**
- Verify `ollama serve` is running: `curl http://localhost:11434/api/tags`
- Check firewall allows port 11434

**"No models found"**
- Run `ollama pull llama3.2:3b` to download a model

**Slow responses**
- Try a smaller model (`phi3:mini`, `llama3.2:1b`)
- Enable GPU acceleration: Ollama auto-detects CUDA/Metal

**Out of memory errors**
- Use a smaller model with lower parameter count
- Close other GPU-intensive applications
- Set `OLLAMA_NUM_PARALLEL=1` to limit concurrent requests

---

## 8. Using Ollama with Docker

When running CrawlForge in Docker, point to the host's Ollama:

```bash
# Linux/Windows (Docker Desktop)
OLLAMA_BASE_URL=http://host.docker.internal:11434

# macOS (Docker Desktop)
OLLAMA_BASE_URL=http://host.docker.internal:11434

# Linux (host network)
docker run --network host -e OLLAMA_BASE_URL=http://localhost:11434 crawlforge
```

See `docs/docker-deployment.md` for full Docker setup.
