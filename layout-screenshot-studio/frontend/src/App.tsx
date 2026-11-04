import { useEffect } from 'react';
import { authToken, onUnauthorized } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import { LoginPage } from '@/components/LoginPage';
import { Workspace } from '@/components/Workspace';
import { ProjectPortal } from '@/components/ProjectPortal';

export default function App() {
  const user = useAppStore((state) => state.user);
  const workspaceEntered = useAppStore((state) => state.workspaceEntered);
  const resetWorkspace = useAppStore((state) => state.resetWorkspace);

  useEffect(() => onUnauthorized(() => {
    authToken.clear();
    resetWorkspace();
  }), [resetWorkspace]);

  return user ? (workspaceEntered ? <Workspace /> : <ProjectPortal />) : <LoginPage />;
}
