import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Hexagon } from 'lucide-react'
import Home from './pages/Home'
import Model from './pages/Model'

function App() {
  const location = useLocation();

  return (
    <>
      <header className="app-header">
        <div className="logo-container">
          <Hexagon size={28} color="var(--accent)" />
          <span>Morphix</span>
        </div>
        <nav className="nav-links">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>Flow</Link>
          <Link to="/model" className={`nav-link ${location.pathname === '/model' ? 'active' : ''}`}>Start Visualizing</Link>
        </nav>
      </header>

      <main style={{ width: '100vw' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/model" element={<Model />} />
        </Routes>
      </main>
    </>
  )
}

export default App
