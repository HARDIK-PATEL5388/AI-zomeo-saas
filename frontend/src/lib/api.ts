// Zomeo.ai API client — connects to Hono.js backend on Railway
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('zomeo_access_token')
}

function authHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const api = {
  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${API_URL}/api${path}`, { headers: authHeader() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `API Error ${res.status}`)
    }
    return res.json()
  },

  async post<T = unknown>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `API Error ${res.status}`)
    }
    return res.json()
  },

  async put<T = unknown>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${API_URL}/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `API Error ${res.status}`)
    }
    return res.json()
  },

  async patch<T = unknown>(path: string, data: unknown): Promise<T> {
    const res = await fetch(`${API_URL}/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `API Error ${res.status}`)
    }
    return res.json()
  },

  async delete<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${API_URL}/api${path}`, {
      method: 'DELETE',
      headers: authHeader(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `API Error ${res.status}`)
    }
    return res.json()
  },

  // Server-Sent Events streaming for AI endpoints
  stream(
    path: string,
    body: unknown,
    onToken: (text: string) => void,
    onDone?: () => void,
    onError?: (err: Error) => void
  ): () => void {
    const ctrl = new AbortController()
    const token = getToken()

    fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Stream error ${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data:'))
        for (const line of lines) {
          const data = line.slice(5).trim()
          if (data === '[DONE]') { onDone?.(); return }
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'token') onToken(parsed.text)
          } catch {}
        }
      }
    }).catch(err => {
      if (err.name !== 'AbortError') onError?.(err)
    })

    return () => ctrl.abort()
  },
}
