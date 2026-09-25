'use client';
import { useState } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([
    { sender: 'bot', text: 'Hello Friend! Ask me anything about calendars and scheduling.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input;
    setInput('');
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userText })
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { sender: 'bot', text: data.answer || data.error }]);
    } catch {
      setMessages((prev) => [...prev, { sender: 'bot', text: 'Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: '680px', margin: '40px auto', fontFamily: 'system-ui, sans-serif', padding: '0 16px' }}>
      <header style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Moses Bot</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: '4px 0 0 0' }}></p>
      </header>

      <div style={{ minHeight: '360px', maxHeight: '520px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
        {messages.map((m, idx) => (
          <div key={idx} style={{
            alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
            background: m.sender === 'user' ? '#1e293b' : '#f1f5f9',
            color: m.sender === 'user' ? '#ffffff' : '#0f172a',
            padding: '10px 14px',
            borderRadius: '12px',
            maxWidth: '85%',
            fontSize: '14px',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap'
          }}>
            {m.text}
          </div>
        ))}
        {loading && <div style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Checking calendars...</div>}
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. When is the next no-school day or early dismissal?"
          style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontWeight: '600', cursor: 'pointer' }}
        >
          Send
        </button>
      </form>
    </main>
  );
}
