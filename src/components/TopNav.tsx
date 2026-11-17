import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export type ActiveRoute = 'register' | 'assignment' | 'details' | 'admin';

interface TopNavProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  isAdminAuthenticated: boolean;
  onAdminLogout?: () => void;
}

export function TopNav({
  activeRoute,
  onNavigate,
  isAdminAuthenticated,
  onAdminLogout,
}: TopNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (route: ActiveRoute) => {
    setMobileMenuOpen(false);
    onNavigate(route);
  };

  return (
    <header className="no-print sticky top-0 z-40 border-b border-[#E5B84B]/20 bg-[#080604]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Zone 1: Single clean wordmark */}
        <button
          type="button"
          onClick={() => handleNav('register')}
          className="font-display text-2xl font-semibold tracking-tight text-[#FBF7EE] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B84B]"
        >
          Dinner Pair
        </button>

        {/* Zone 2: Concise single-line nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-300">
          <button
            type="button"
            onClick={() => handleNav('register')}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
              activeRoute === 'register'
                ? 'text-[#E5B84B] border-b border-[#E5B84B]'
                : 'hover:text-white'
            }`}
          >
            Register
          </button>
          <button
            type="button"
            onClick={() => handleNav('assignment')}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
              activeRoute === 'assignment'
                ? 'text-[#E5B84B] border-b border-[#E5B84B]'
                : 'hover:text-white'
            }`}
          >
            My Assignment
          </button>
          <button
            type="button"
            onClick={() => handleNav('details')}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
              activeRoute === 'details'
                ? 'text-[#E5B84B] border-b border-[#E5B84B]'
                : 'hover:text-white'
            }`}
          >
            Event Details
          </button>
          <button
            type="button"
            onClick={() => handleNav('admin')}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
              activeRoute === 'admin'
                ? 'text-[#E5B84B] border-b border-[#E5B84B]'
                : 'hover:text-white'
            }`}
          >
            Admin Portal
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {activeRoute === 'admin' && isAdminAuthenticated && onAdminLogout ? (
            <button
              type="button"
              onClick={onAdminLogout}
              className="hidden md:inline-flex items-center justify-center rounded-lg border border-[#E5B84B]/30 bg-white/5 px-4 py-2 text-xs font-semibold text-stone-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                handleNav(activeRoute === 'register' ? 'assignment' : 'register')
              }
              className="hidden md:inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-4 py-2 text-xs font-bold text-[#0A0704] hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              {activeRoute === 'register' ? 'Retrieve Match' : 'Register Now'}
            </button>
          )}

          <button
            type="button"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5B84B]/25 text-stone-200 hover:bg-white/10"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#E5B84B]/20 bg-[#100C07] px-4 py-3 space-y-1">
          <button
            type="button"
            onClick={() => handleNav('register')}
            className={`block w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
              activeRoute === 'register' ? 'bg-white/10 text-[#E5C158]' : 'text-slate-200'
            }`}
          >
            Register for Dinner
          </button>
          <button
            type="button"
            onClick={() => handleNav('assignment')}
            className={`block w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
              activeRoute === 'assignment' ? 'bg-white/10 text-[#E5C158]' : 'text-slate-200'
            }`}
          >
            My Assignment
          </button>
          <button
            type="button"
            onClick={() => handleNav('details')}
            className={`block w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
              activeRoute === 'details' ? 'bg-white/10 text-[#E5C158]' : 'text-slate-200'
            }`}
          >
            Event Details
          </button>
          <button
            type="button"
            onClick={() => handleNav('admin')}
            className={`block w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
              activeRoute === 'admin' ? 'bg-white/10 text-[#E5C158]' : 'text-slate-200'
            }`}
          >
            Admin Portal
          </button>
          {activeRoute === 'admin' && isAdminAuthenticated && onAdminLogout && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onAdminLogout();
              }}
              className="block w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-rose-300"
            >
              Sign Out
            </button>
          )}
        </div>
      )}
    </header>
  );
}
