import { useEffect } from "react";
import "./App.css";
import { useStudioStore } from "./app/store";
import { ProjectBrowser } from "./features/project-browser/ProjectBrowser";
import { ProjectWorkspace } from "./features/project-browser/ProjectWorkspace";
import { RenderQueueProcessor } from "./features/render-queue/RenderQueueProcessor";
import { StartupModeGate } from "./features/startup/StartupModeGate";

function App() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const bootstrap = useStudioStore((state) => state.bootstrap);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);

  useEffect(() => {
    if (musicAiMode) {
      void bootstrap();
    }
  }, [bootstrap, musicAiMode]);

  if (!musicAiMode) {
    return <StartupModeGate />;
  }

  return (
    <>
      <RenderQueueProcessor />
      {activeProject ? <ProjectWorkspace /> : <ProjectBrowser />}
    </>
  );
}

export default App;
