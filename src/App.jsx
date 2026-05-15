import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn, isAdmin } from './lib/store';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Build from './pages/Build';
import Device from './pages/Device';
import Keystroke from './pages/Keystroke';
import Reader from './pages/Reader';
import Camera from './pages/Camera';
import Inbox from './pages/Inbox';
import CreateUser from './pages/CreateUser';
import ManageUsers from './pages/ManageUsers';
import Keystore from './pages/Keystore';
import More from './pages/More';

function Private({ children, adminOnly = false }) {
  if (!isLoggedIn()) return <Navigate to="/" replace />;
  if (adminOnly && !isAdmin()) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={isLoggedIn() ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/dashboard"             element={<Private><Dashboard /></Private>} />
      <Route path="/build"                 element={<Private><Build /></Private>} />
      <Route path="/device/:id"            element={<Private><Device /></Private>} />
      <Route path="/device/:id/keystroke"  element={<Private><Keystroke /></Private>} />
      <Route path="/device/:id/reader"     element={<Private><Reader /></Private>} />
      <Route path="/device/:id/camera"     element={<Private><Camera /></Private>} />
      <Route path="/device/:id/inbox"      element={<Private><Inbox /></Private>} />
      <Route path="/device/:id/keystore"   element={<Private><Keystore /></Private>} />
      <Route path="/device/:id/more"        element={<Private><More /></Private>} />
      <Route path="/create-user"           element={<Private adminOnly><CreateUser /></Private>} />
      <Route path="/manage-users"          element={<Private adminOnly><ManageUsers /></Private>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
