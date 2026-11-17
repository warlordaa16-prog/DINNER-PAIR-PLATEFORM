import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './lib/api';
import { initFirebaseAuthListener, signOutGoogleWorkspace } from './lib/firebase';
import { AdminUser, PublicEventResponse } from './types';
import { ActiveRoute, TopNav } from './components/TopNav';
import { PublicRegistrationView } from './components/PublicRegistrationView';
import { PrivateAssignmentView } from './components/PrivateAssignmentView';
import { AdminDashboardView } from './components/AdminDashboardView';

function parseHashRoute(): ActiveRoute {
  const h = window.location.hash.replace('#', '').toLowerCase();
  if (h === 'assignment' || h === 'details' || h === 'admin') return h;
  return 'register';
}

export default function App() {
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>(parseHashRoute);
  const [eventData, setEventData] = useState<PublicEventResponse | null>(null);
  const [eventLoading, setEventLoading] = useState(true);

  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [prefillRef, setPrefillRef] = useState('');
  const [prefillPhone, setPrefillPhone] = useState('');

  const loadPublicEvent = useCallback(async () => {
    try {
      const data = await apiRequest<PublicEventResponse>('/api/public/event');
      setEventData(data);
    } catch {
      // Handled gracefully in UI
    } finally {
      setEventLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPublicEvent();

    apiRequest<{ admin: AdminUser }>('/api/admin/me')
      .then((res) => setAdmin(res.admin))
      .catch(() => setAdmin(null));

    const unsubscribe = initFirebaseAuthListener();
    const onHashChange = () => setActiveRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);

    return () => {
      unsubscribe();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [loadPublicEvent]);

  const navigate = (route: ActiveRoute) => {
    setActiveRoute(route);
    window.location.hash = route;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoToAssignment = (ref?: string, phone?: string) => {
    if (ref) setPrefillRef(ref);
    if (phone) setPrefillPhone(phone);
    navigate('assignment');
  };

  const handleAdminLogout = async () => {
    await apiRequest('/api/admin/logout', { method: 'POST' }).catch(() => {});
    await signOutGoogleWorkspace().catch(() => {});
    setAdmin(null);
  };

  return (
    <div className="min-h-screen flex flex-col candlelight-backdrop text-[#FBF7EE]">
      <TopNav
        activeRoute={activeRoute}
        onNavigate={navigate}
        isAdminAuthenticated={Boolean(admin)}
        onAdminLogout={handleAdminLogout}
      />

      <div className="flex-1">
        {(activeRoute === 'register' || activeRoute === 'details') && (
          <PublicRegistrationView
            eventData={eventData}
            loading={eventLoading}
            showDetailsFocus={activeRoute === 'details'}
            onGoToAssignment={handleGoToAssignment}
            onRegistered={loadPublicEvent}
          />
        )}

        {activeRoute === 'assignment' && (
          <PrivateAssignmentView
            initialRef={prefillRef}
            initialPhone={prefillPhone}
            onGoToRegister={() => navigate('register')}
          />
        )}

        {activeRoute === 'admin' && (
          <AdminDashboardView
            admin={admin}
            onAdminAuthenticated={setAdmin}
            onAdminLoggedOut={() => setAdmin(null)}
            onEventUpdated={loadPublicEvent}
          />
        )}
      </div>

      <footer className="no-print border-t border-[#E5B84B]/20 bg-[#050403] py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-stone-400 sm:px-6 lg:px-8">
          <span>
            Dinner Pair · {eventData?.event.organizerName || 'Manifest Association'} · {eventData?.event.eventName || 'Makindye Campuses Dinner'}
          </span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => navigate('register')}
              className="hover:text-[#E5B84B] cursor-pointer"
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => navigate('assignment')}
              className="hover:text-[#E5B84B] cursor-pointer"
            >
              My Assignment
            </button>
            <button
              type="button"
              onClick={() => navigate('admin')}
              className="hover:text-[#E5B84B] cursor-pointer"
            >
              Admin Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
