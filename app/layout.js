export const metadata = {
  title: 'Moses Bot',
  description: 'Unofficially answering your calendar and schedule related questions.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
