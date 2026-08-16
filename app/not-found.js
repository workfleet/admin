import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container login-page">
      <div className="brand-mark">WF</div>
      <h1>Page not found</h1>
      <p className="login-subtitle">That page doesn't exist, or you don't have access to it.</p>
      <Link href="/" style={{ marginTop: 8 }}>
        <button type="button">Back to Home</button>
      </Link>
    </div>
  );
}
