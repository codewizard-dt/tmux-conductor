import { createBrowserRouter, RouterProvider, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import AgentsPage from './pages/AgentsPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'

function Dashboard() {
  return (
    <div className="min-h-screen bg-canvas">
      <NavBar />
      <Routes>
        <Route path="/" element={<AgentsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/*', element: <Dashboard /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
