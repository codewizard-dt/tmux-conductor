import AddProjectForm from '../components/AddProjectForm'
import ProjectList from '../components/ProjectList'

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
      <AddProjectForm />
      <ProjectList />
    </main>
  )
}
