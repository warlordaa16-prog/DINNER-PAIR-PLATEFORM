import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarCheck,
  Check,
  Copy,
  Download,
  FileText,
  Gift,
  KeyRound,
  LayoutDashboard,
  Lock,
  Plus,
  Printer,
  Search,
  Settings,
  Shield,
  Trash2,
  Unlink,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { signInWithGoogleWorkspace, signOutGoogleWorkspace } from '../lib/firebase';
import {
  AdminSettingsResponse,
  AdminUser,
  AttendanceStatus,
  EventStatus,
  OverviewResponse,
  PairingMode,
  PairingsResponse,
  ParticipantRecord,
  TicketCategory,
} from '../types';
import { DashboardCharts } from './DashboardCharts';
import { AdminGoogleFormsPanel } from './AdminGoogleFormsPanel';

type AdminTab =
  | 'overview'
  | 'registrations'
  | 'attendance'
  | 'pairings'
  | 'reports'
  | 'event'
  | 'settings';

interface AdminDashboardViewProps {
  admin: AdminUser | null;
  onAdminAuthenticated: (admin: AdminUser) => void;
  onAdminLoggedOut: () => void;
  onEventUpdated: () => void;
}

const SIDEBAR_ITEMS: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'registrations', label: 'Registrations', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'pairings', label: 'Gift Pairings', icon: Gift },
  { id: 'reports', label: 'Reports & Exports', icon: FileText },
  { id: 'event', label: 'Event Settings', icon: Settings },
  { id: 'settings', label: 'Admin Settings', icon: Shield },
];

export function AdminDashboardView({
  admin,
  onAdminAuthenticated,
  onAdminLoggedOut,
  onEventUpdated,
}: AdminDashboardViewProps) {
  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Dashboard state
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [pairingsData, setPairingsData] = useState<PairingsResponse | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettingsResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [attendanceFilter, setAttendanceFilter] = useState('ALL');
  const [consentFilter, setConsentFilter] = useState('all');
  const [pairingFilter, setPairingFilter] = useState('all');

  // Participant Add/Edit modal
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRecord | null>(null);
  const [formFullName, setFormFullName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formResidence, setFormResidence] = useState('');
  const [formTicketCategory, setFormTicketCategory] = useState<TicketCategory>('STUDENT');
  const [formAttendance, setFormAttendance] = useState<AttendanceStatus>('CONFIRMED');
  const [formConsent, setFormConsent] = useState(true);
  const [savingParticipant, setSavingParticipant] = useState(false);

  // Issued OTP modal
  const [issuedOtpModal, setIssuedOtpModal] = useState<{
    fullName: string;
    registrationReference: string;
    phoneNumber: string;
    code: string;
    expiresInMinutes: number;
  } | null>(null);
  const [copiedOtp, setCopiedOtp] = useState(false);

  // Pairing controls
  const [selectedMode, setSelectedMode] = useState<PairingMode>('SECRET');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [swapSelection, setSwapSelection] = useState<number[]>([]);
  const [manualGiverId, setManualGiverId] = useState<number | ''>('');
  const [manualRecipientId, setManualRecipientId] = useState<number | ''>('');
  const [manualMutual, setManualMutual] = useState(true);

  // Event settings form
  const [evOrganizer, setEvOrganizer] = useState('');
  const [evName, setEvName] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evVenue, setEvVenue] = useState('');
  const [evDressCode, setEvDressCode] = useState('');
  const [evBudget, setEvBudget] = useState('');
  const [evTicketInfo, setEvTicketInfo] = useState('');
  const [evContactPhone, setEvContactPhone] = useState('');
  const [evDeadline, setEvDeadline] = useState('');
  const [evStatus, setEvStatus] = useState<EventStatus>('OPEN');
  const [evAllowUpdates, setEvAllowUpdates] = useState(true);
  const [evGoogleFormId, setEvGoogleFormId] = useState('');
  const [evGoogleFormUrl, setEvGoogleFormUrl] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

  // Admin settings forms
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');
  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');

  const loadDashboardData = useCallback(async () => {
    if (!admin) return;
    setLoadingData(true);
    setBannerError(null);
    try {
      const [ov, partRes, pairRes, setRes] = await Promise.all([
        apiRequest<OverviewResponse>('/api/admin/overview'),
        apiRequest<{ participants: ParticipantRecord[] }>('/api/admin/participants'),
        apiRequest<PairingsResponse>('/api/admin/pairings'),
        apiRequest<AdminSettingsResponse>('/api/admin/settings'),
      ]);
      setOverview(ov);
      setParticipants(partRes.participants);
      setPairingsData(pairRes);
      setAdminSettings(setRes);

      // Sync event settings form fields
      setEvOrganizer(ov.event.organizerName || 'Manifest Association');
      setEvName(ov.event.eventName);
      setEvDate(ov.event.eventDate);
      setEvVenue(ov.event.venue);
      setEvDressCode(ov.event.dressCode || '');
      setEvBudget(ov.event.giftBudget || '');
      setEvTicketInfo(ov.event.ticketInfo || '');
      setEvContactPhone(ov.event.contactPhone || '');
      setEvDeadline(ov.event.registrationDeadline);
      setEvStatus(ov.event.eventStatus);
      setEvAllowUpdates(ov.event.allowAttendanceUpdates);
      setEvGoogleFormId(ov.event.googleFormId || '');
      setEvGoogleFormUrl(ov.event.googleFormUrl || '');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        onAdminLoggedOut();
        return;
      }
      setBannerError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
    } finally {
      setLoadingData(false);
    }
  }, [admin, onAdminLoggedOut]);

  useEffect(() => {
    if (admin) {
      loadDashboardData();
    }
  }, [admin, loadDashboardData]);

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await apiRequest<{ admin: AdminUser }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      onAdminAuthenticated(res.admin);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Invalid credentials.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setGoogleBusy(true);
    try {
      const { idToken } = await signInWithGoogleWorkspace();
      const res = await apiRequest<{ admin: AdminUser }>('/api/admin/google-login', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      onAdminAuthenticated(res.admin);
    } catch (err: unknown) {
      await signOutGoogleWorkspace().catch(() => {});
      setLoginError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const openAddModal = () => {
    setEditingParticipant(null);
    setFormFullName('');
    setFormPhone('');
    setFormEmail('');
    setFormResidence('');
    setFormTicketCategory('STUDENT');
    setFormAttendance('CONFIRMED');
    setFormConsent(true);
    setParticipantModalOpen(true);
  };

  const openEditModal = (p: ParticipantRecord) => {
    setEditingParticipant(p);
    setFormFullName(p.fullName);
    setFormPhone(p.phoneNumber);
    setFormEmail(p.email || '');
    setFormResidence(p.residence);
    setFormTicketCategory(p.ticketCategory || 'STUDENT');
    setFormAttendance(p.attendanceStatus);
    setFormConsent(p.giftExchangeConsent);
    setParticipantModalOpen(true);
  };

  const handleSaveParticipant = async (e: FormEvent) => {
    e.preventDefault();
    setSavingParticipant(true);
    setBannerError(null);
    try {
      if (editingParticipant) {
        await apiRequest(`/api/admin/participants/${editingParticipant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: formFullName,
            phoneNumber: formPhone,
            email: formEmail,
            residence: formResidence,
            ticketCategory: formTicketCategory,
            attendanceStatus: formAttendance,
            giftExchangeConsent: formConsent,
          }),
        });
        setBannerSuccess(`Updated registration for ${formFullName}.`);
      } else {
        await apiRequest('/api/admin/participants', {
          method: 'POST',
          body: JSON.stringify({
            fullName: formFullName,
            phoneNumber: formPhone,
            email: formEmail,
            residence: formResidence,
            ticketCategory: formTicketCategory,
            attendanceStatus: formAttendance,
            giftExchangeConsent: formConsent,
          }),
        });
        setBannerSuccess(`Registered ${formFullName}.`);
      }
      setParticipantModalOpen(false);
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to save participant.');
    } finally {
      setSavingParticipant(false);
    }
  };

  const handleQuickAttendanceChange = async (
    p: ParticipantRecord,
    nextStatus: AttendanceStatus
  ) => {
    setBannerError(null);
    try {
      await apiRequest(`/api/admin/participants/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ attendanceStatus: nextStatus }),
      });
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to update attendance.');
    }
  };

  const handleDeleteParticipant = async (p: ParticipantRecord) => {
    setBannerError(null);
    try {
      await apiRequest(`/api/admin/participants/${p.id}`, { method: 'DELETE' });
      setBannerSuccess(`Removed registration ${p.registrationReference} (${p.fullName}).`);
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Unable to delete participant.');
    }
  };

  const handleIssueOtp = async (p: ParticipantRecord) => {
    setBannerError(null);
    try {
      const data = await apiRequest<{
        code: string;
        expiresInMinutes: number;
        registrationReference: string;
        phoneNumber: string;
        fullName: string;
      }>(`/api/admin/participants/${p.id}/issue-otp`, { method: 'POST' });
      setCopiedOtp(false);
      setIssuedOtpModal(data);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not issue verification code.');
    }
  };

  const handleSeedSampleCohort = async () => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/seed-sample', {
        method: 'POST',
      });
      setBannerSuccess(res.message);
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to load sample cohort.');
    }
  };

  const handleGeneratePairings = async () => {
    setPairingBusy(true);
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await apiRequest<{
        batchId: number;
        totalPaired: number;
        totalQueued: number;
        mode: PairingMode;
      }>('/api/admin/pairings/generate', {
        method: 'POST',
        body: JSON.stringify({ mode: selectedMode }),
      });
      setBannerSuccess(
        `Generated draft batch #${res.batchId} (${res.mode}): ${res.totalPaired} assignments created${
          res.totalQueued > 0 ? `, ${res.totalQueued} in unpaired queue` : ''
        }. Review and lock when ready.`
      );
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to generate pairings.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleLockBatch = async (batchId: number) => {
    setPairingBusy(true);
    setBannerError(null);
    try {
      const res = await apiRequest<{ lockedCount: number }>(
        `/api/admin/pairings/${batchId}/lock`,
        { method: 'POST' }
      );
      setBannerSuccess(
        `Locked ${res.lockedCount} gift assignment(s). Participants can now retrieve their matches privately.`
      );
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to lock batch.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleDiscardBatch = async (batchId: number) => {
    setPairingBusy(true);
    setBannerError(null);
    try {
      await apiRequest(`/api/admin/pairings/${batchId}`, { method: 'DELETE' });
      setBannerSuccess(`Discarded unlocked draft batch #${batchId}.`);
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to discard draft batch.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleUnlinkParticipant = async (participantId: number) => {
    setPairingBusy(true);
    setBannerError(null);
    try {
      await apiRequest('/api/admin/pairings/reassign', {
        method: 'POST',
        body: JSON.stringify({ action: 'UNLINK_PARTICIPANT', participantId }),
      });
      setBannerSuccess('Unlinked participant pairing. Surviving partners returned to unpaired pool.');
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to unlink pairing.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleSwapSelected = async () => {
    if (swapSelection.length !== 2) return;
    setPairingBusy(true);
    setBannerError(null);
    try {
      await apiRequest('/api/admin/pairings/reassign', {
        method: 'POST',
        body: JSON.stringify({
          action: 'SWAP_RECIPIENTS',
          pairingIdA: swapSelection[0],
          pairingIdB: swapSelection[1],
        }),
      });
      setSwapSelection([]);
      setBannerSuccess('Swapped recipients cleanly inside a database transaction.');
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to swap recipients.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleManualPair = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualGiverId || !manualRecipientId) return;
    setPairingBusy(true);
    setBannerError(null);
    try {
      await apiRequest('/api/admin/pairings/reassign', {
        method: 'POST',
        body: JSON.stringify({
          action: 'MANUAL_PAIR',
          giverId: manualGiverId,
          recipientId: manualRecipientId,
          mutual: manualMutual,
        }),
      });
      setManualGiverId('');
      setManualRecipientId('');
      setBannerSuccess('Created locked manual pairing assignment.');
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Manual pairing failed.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleSaveEventSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingEvent(true);
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiRequest('/api/admin/event', {
        method: 'PUT',
        body: JSON.stringify({
          organizerName: evOrganizer,
          eventName: evName,
          eventDate: evDate,
          venue: evVenue,
          dressCode: evDressCode,
          giftBudget: evBudget,
          ticketInfo: evTicketInfo,
          contactPhone: evContactPhone,
          registrationDeadline: evDeadline,
          eventStatus: evStatus,
          allowAttendanceUpdates: evAllowUpdates,
          googleFormId: evGoogleFormId,
          googleFormUrl: evGoogleFormUrl,
        }),
      });
      setBannerSuccess('Event settings saved.');
      await loadDashboardData();
      onEventUpdated();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to save event settings.');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleCreateAdmin = async (e: FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiRequest('/api/admin/administrators', {
        method: 'POST',
        body: JSON.stringify({
          username: newAdminUsername,
          email: newAdminEmail,
          password: newAdminPassword,
          role: newAdminRole,
        }),
      });
      setNewAdminUsername('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      setBannerSuccess('Administrator account created.');
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to add administrator.');
    }
  };

  const handleDeleteAdmin = async (id: number) => {
    setBannerError(null);
    try {
      await apiRequest(`/api/admin/administrators/${id}`, { method: 'DELETE' });
      setBannerSuccess('Administrator account removed.');
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not remove administrator.');
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiRequest('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: nextPw }),
      });
      setCurrentPw('');
      setNextPw('');
      setBannerSuccess('Administrator password updated.');
      await loadDashboardData();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to update password.');
    }
  };

  /* ========================================================================
   * ADMIN AUTHENTICATION GATE
   * ====================================================================== */
  if (!admin) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-[#E5B84B]/60 bg-[#100C07]/95 p-7 text-[#FBF7EE] ring-1 ring-inset ring-[#E5B84B]/20 shadow-2xl sm:p-9 space-y-6">
          <div className="border-b border-[#E5B84B]/25 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E5B84B]">
              Restricted Access
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-white">
              Administrator Sign-In
            </h1>
            <p className="mt-1 text-sm text-stone-300">
              Manage registrations, attendance confirmations, automated gift
              pairings, and Google Forms sync.
            </p>
          </div>

          {loginError && (
            <div className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">
              {loginError}
            </div>
          )}

          {/* Official Google Sign-In for Google Workspace + Admin Auth */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleBusy || loginBusy}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {googleBusy ? 'Verifying Google Account...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </div>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#E5B84B]/20" />
            <span className="mx-3 shrink text-xs text-stone-400">
              or sign in with credentials
            </span>
            <div className="flex-grow border-t border-[#E5B84B]/20" />
          </div>

          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label
                htmlFor="admin-identifier"
                className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
              >
                Username or Email
              </label>
              <input
                id="admin-identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin"
                className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
              >
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
              />
            </div>

            <button
              type="submit"
              disabled={loginBusy || googleBusy}
              className="w-full rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-4 py-3 text-sm font-bold text-[#0A0704] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loginBusy ? 'Signing In...' : 'Sign In to Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ========================================================================
   * FILTERED PARTICIPANTS
   * ====================================================================== */
  const filteredParticipants = participants.filter((p) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${p.registrationReference} ${p.fullName} ${p.phoneNumber} ${p.email || ''} ${p.residence}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (attendanceFilter !== 'ALL' && p.attendanceStatus !== attendanceFilter) {
      return false;
    }
    if (consentFilter === 'yes' && !p.giftExchangeConsent) return false;
    if (consentFilter === 'no' && p.giftExchangeConsent) return false;
    if (pairingFilter !== 'all' && p.pairingStatus.toLowerCase() !== pairingFilter) {
      return false;
    }
    return true;
  });

  const stats = overview?.stats;
  const activePreview = pairingsData?.previews[selectedMode];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar Navigation */}
        <aside className="no-print w-full shrink-0 lg:w-64">
          <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-4 space-y-5">
            <div className="border-b border-white/10 pb-3 px-2">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="text-sm font-semibold text-white truncate">
                {admin.username}
              </p>
              <p className="text-xs text-[#E5B84B] truncate">{admin.email}</p>
            </div>

            <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-1">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#E5B84B] text-[#0A0704] font-semibold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="min-w-0 flex-1 space-y-6">
          {/* Global Feedback Banners */}
          {bannerError && (
            <div className="no-print rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-4">
              <span>{bannerError}</span>
              <button
                type="button"
                onClick={() => setBannerError(null)}
                className="text-xs underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
          {bannerSuccess && (
            <div className="no-print rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200 flex items-center justify-between gap-4">
              <span>{bannerSuccess}</span>
              <button
                type="button"
                onClick={() => setBannerSuccess(null)}
                className="text-xs underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ==============================================================
           * TAB 1: OVERVIEW
           * ============================================================ */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-semibold text-white">
                    {overview?.event.eventName || 'Event Overview'}
                  </h1>
                  <p className="text-xs text-slate-400">
                    Real-time registration, attendance confirmation, and gift pairing metrics
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {stats && stats.totalRegistrations === 0 && (
                    <button
                      type="button"
                      onClick={handleSeedSampleCohort}
                      className="rounded-lg border border-[#D4AF37]/50 bg-[#E5B84B]/10 px-3.5 py-2 text-xs font-semibold text-[#E5B84B] hover:bg-[#E5B84B]/20 cursor-pointer"
                    >
                      Load 12 Sample Guests
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab('pairings')}
                    className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158] cursor-pointer"
                  >
                    Manage Gift Pairings
                  </button>
                </div>
              </div>

              {/* Withdrawal Warning Banner */}
              {overview && overview.withdrawnAlerts.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span>
                      {overview.withdrawnAlerts.length} Pairing(s) Affected by Withdrawal or Opt-Out
                    </span>
                  </div>
                  <p className="text-xs text-amber-100/80">
                    A paired participant changed their attendance or gift consent. Review and
                    unlink or reassign them in Gift Pairings.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pairings')}
                    className="text-xs font-semibold text-[#E5B84B] underline hover:no-underline cursor-pointer"
                  >
                    Resolve in Gift Pairings
                  </button>
                </div>
              )}

              {/* 8 KPI Cards */}
              {loadingData && !stats ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : (
                stats && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: 'Total Registrations', value: stats.totalRegistrations, sub: 'All guest records' },
                        { label: 'Confirmed Attendees', value: stats.confirmedAttendees, sub: 'Confirmed for dinner' },
                        { label: 'Pending Confirmations', value: stats.pendingConfirmations, sub: 'Awaiting RSVP' },
                        { label: 'Unable to Attend', value: stats.unableToAttend, sub: 'Declined dinner' },
                        { label: 'Gift Exchange Participants', value: stats.giftExchangeParticipants, sub: 'Consented to gift' },
                        { label: 'Successfully Paired', value: stats.successfullyPaired, sub: `${stats.lockedPairings} permanently locked` },
                        { label: 'Unpaired Eligible', value: stats.unpairedEligible, sub: 'Confirmed + consented' },
                        { label: 'Opted Out of Gifting', value: stats.optedOutOfGifting, sub: 'Dinner only' },
                      ].map((kpi) => (
                        <div
                          key={kpi.label}
                          className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-5"
                        >
                          <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
                          <p className="mt-2 font-mono-tabular text-3xl font-semibold text-white">
                            {kpi.value}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">{kpi.sub}</p>
                        </div>
                      ))}
                    </div>

                    <DashboardCharts
                      stats={stats}
                      dailyTrend={overview?.dailyTrend || []}
                    />
                  </>
                )
              )}
            </div>
          )}

          {/* ==============================================================
           * TAB 2: REGISTRATIONS
           * ============================================================ */}
          {activeTab === 'registrations' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-semibold text-white">
                    Participant Registrations
                  </h1>
                  <p className="text-xs text-slate-400 tabular-nums">
                    Showing {filteredParticipants.length} of {participants.length} total registrations
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {participants.length === 0 && (
                    <button
                      type="button"
                      onClick={handleSeedSampleCohort}
                      className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
                    >
                      Load 12 Sample Guests
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158] cursor-pointer"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Add Participant
                  </button>
                </div>
              </div>

              {/* Google Forms Integration Card */}
              <AdminGoogleFormsPanel
                linkedFormId={overview?.event.googleFormId}
                linkedFormUrl={overview?.event.googleFormUrl}
                onSynced={loadDashboardData}
              />

              {/* Search & Filter Toolbar */}
              <div className="grid gap-3 rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, ref, phone, location..."
                    className="w-full rounded-lg border border-white/15 bg-[#080604] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <select
                  value={attendanceFilter}
                  onChange={(e) => setAttendanceFilter(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                >
                  <option value="ALL">All Attendance Statuses</option>
                  <option value="CONFIRMED">Confirmed Only</option>
                  <option value="PENDING">Pending Only</option>
                  <option value="DECLINED">Declined Only</option>
                </select>
                <select
                  value={consentFilter}
                  onChange={(e) => setConsentFilter(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                >
                  <option value="all">All Gift Exchange Consent</option>
                  <option value="yes">Participating in Gift Exchange</option>
                  <option value="no">Opted Out of Gift Exchange</option>
                </select>
                <select
                  value={pairingFilter}
                  onChange={(e) => setPairingFilter(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                >
                  <option value="all">All Pairing Statuses</option>
                  <option value="locked">Locked</option>
                  <option value="draft">Draft</option>
                  <option value="unpaired">Unpaired Eligible</option>
                  <option value="ineligible">Ineligible</option>
                </select>
              </div>

              {/* Participant Table */}
              <div className="overflow-hidden rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90">
                {filteredParticipants.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <p className="text-sm text-slate-300">
                      No participants match your current filters.
                    </p>
                    {participants.length === 0 && (
                      <button
                        type="button"
                        onClick={openAddModal}
                        className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] cursor-pointer"
                      >
                        Add First Participant
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E5B84B]/20 bg-[#0A0805] text-stone-400">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Ref ID</th>
                          <th className="px-4 py-3 font-semibold">Full Name</th>
                          <th className="px-4 py-3 font-semibold">Phone / Email</th>
                          <th className="px-4 py-3 font-semibold">Residence</th>
                          <th className="px-4 py-3 font-semibold">Ticket</th>
                          <th className="px-4 py-3 font-semibold">Attendance</th>
                          <th className="px-4 py-3 font-semibold">Gift Consent</th>
                          <th className="px-4 py-3 font-semibold">Pairing</th>
                          <th className="px-4 py-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {filteredParticipants.map((p) => (
                          <tr key={p.id} className="hover:bg-white/[0.03]">
                            <td className="px-4 py-3 font-mono-tabular text-[#E5B84B] whitespace-nowrap">
                              {p.registrationReference}
                            </td>
                            <td className="px-4 py-3 font-medium text-white">
                              {p.fullName}
                              {p.source === 'GOOGLE_FORM' && (
                                <span className="ml-1.5 text-[10px] text-stone-400">
                                  · Form
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-stone-300">
                              <div className="font-mono-tabular">{p.phoneNumber}</div>
                              {p.email && (
                                <div className="text-[11px] text-stone-400">{p.email}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-stone-300">{p.residence}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={p.ticketCategory === 'ALUMNI' ? 'font-medium text-[#F5D67B]' : 'text-stone-300'}>
                                {p.ticketCategory === 'ALUMNI' ? 'Alumni' : 'Student'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  p.attendanceStatus === 'CONFIRMED'
                                    ? 'text-emerald-400 font-medium'
                                    : p.attendanceStatus === 'PENDING'
                                      ? 'text-amber-400 font-medium'
                                      : 'text-rose-400 font-medium'
                                }
                              >
                                {p.attendanceStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-stone-300">
                              {p.giftExchangeConsent ? 'Yes' : 'Opted Out'}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  p.pairingStatus === 'LOCKED'
                                    ? 'text-emerald-400 font-medium'
                                    : p.pairingStatus === 'DRAFT'
                                      ? 'text-[#E5B84B] font-medium'
                                      : 'text-slate-400'
                                }
                              >
                                {p.pairingStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                              <button
                                type="button"
                                onClick={() => handleIssueOtp(p)}
                                title="Issue one-time verification code"
                                className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer"
                              >
                                <KeyRound className="h-3 w-3" />
                                Code
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                className="rounded border border-white/15 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteParticipant(p)}
                                title="Delete registration"
                                className="inline-flex items-center rounded border border-rose-500/30 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/50 cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==============================================================
           * TAB 3: ATTENDANCE TRACKING
           * ============================================================ */}
          {activeTab === 'attendance' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-semibold text-white">
                  Attendance Monitor
                </h1>
                <p className="text-xs text-slate-400">
                  Confirm guest attendance directly and spot withdrawals affecting pairings
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E5B84B]/20 bg-[#0A0805] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Ref ID</th>
                        <th className="px-4 py-3 font-semibold">Guest Name</th>
                        <th className="px-4 py-3 font-semibold">Telephone</th>
                        <th className="px-4 py-3 font-semibold">Gift Consent</th>
                        <th className="px-4 py-3 font-semibold">Pairing Status</th>
                        <th className="px-4 py-3 font-semibold">Update Attendance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {participants.map((p) => {
                        const isWithdrawnAlert =
                          (p.pairingStatus === 'LOCKED' || p.pairingStatus === 'DRAFT') &&
                          (p.attendanceStatus !== 'CONFIRMED' || !p.giftExchangeConsent);
                        return (
                          <tr key={p.id} className="hover:bg-white/[0.03]">
                            <td className="px-4 py-3 font-mono-tabular text-[#E5B84B]">
                              {p.registrationReference}
                            </td>
                            <td className="px-4 py-3 font-medium text-white">
                              {p.fullName}
                              {isWithdrawnAlert && (
                                <span className="ml-2 text-amber-400 font-semibold">
                                  · Paired but Withdrawn
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-slate-300">
                              {p.phoneNumber}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {p.giftExchangeConsent ? 'Participating' : 'Opted Out'}
                            </td>
                            <td className="px-4 py-3 text-slate-300">{p.pairingStatus}</td>
                            <td className="px-4 py-3">
                              <div className="inline-flex rounded-lg border border-white/10 bg-[#080604] p-0.5">
                                {(['CONFIRMED', 'PENDING', 'DECLINED'] as const).map((st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => handleQuickAttendanceChange(p, st)}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                                      p.attendanceStatus === st
                                        ? st === 'CONFIRMED'
                                          ? 'bg-emerald-600 text-white'
                                          : st === 'PENDING'
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-rose-600 text-white'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    {st === 'CONFIRMED' ? 'Confirm' : st === 'PENDING' ? 'Pending' : 'Decline'}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
           * TAB 4: GIFT PAIRINGS ENGINE
           * ============================================================ */}
          {activeTab === 'pairings' && pairingsData && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-semibold text-white">
                  Automated Gift Pairing Engine
                </h1>
                <p className="text-xs text-slate-400">
                  Select a pairing algorithm, preview eligibility, generate draft assignments, and lock when finalized
                </p>
              </div>

              {/* Mode Selector + Preview Panel */}
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-5">
                  <h2 className="text-sm font-semibold text-white">
                    01. Select Pairing Algorithm
                  </h2>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSelectedMode('MUTUAL')}
                      className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                        selectedMode === 'MUTUAL'
                          ? 'border-[#D4AF37] bg-[#E5B84B]/10'
                          : 'border-white/10 bg-[#080604] hover:border-white/25'
                      }`}
                    >
                      <p className="text-sm font-semibold text-white">
                        Mode A: Mutual Pairing
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">
                        Groups eligible guests in pairs (A gifts B, B gifts A). Odd
                        participants stay in the unpaired queue without altering
                        locked pairs.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedMode('SECRET')}
                      className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                        selectedMode === 'SECRET'
                          ? 'border-[#D4AF37] bg-[#E5B84B]/10'
                          : 'border-white/10 bg-[#080604] hover:border-white/25'
                      }`}
                    >
                      <p className="text-sm font-semibold text-white">
                        Mode B: Secret Gift Exchange
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">
                        Randomized derangement (A → B → C → A). Nobody is assigned
                        themselves; every guest gives and receives exactly one gift.
                      </p>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleGeneratePairings}
                      disabled={pairingBusy || !activePreview?.canGenerate}
                      className="rounded-lg bg-[#E5B84B] px-5 py-2.5 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158] disabled:opacity-40 cursor-pointer"
                    >
                      {pairingBusy
                        ? 'Running Algorithm...'
                        : activePreview?.hasUnlockedDraft
                          ? 'Regenerate Draft Pairings'
                          : 'Generate Draft Pairings'}
                    </button>
                    {!activePreview?.canGenerate && activePreview?.reason && (
                      <span className="text-xs text-amber-300">
                        {activePreview.reason}
                      </span>
                    )}
                  </div>
                </div>

                {/* Live Preview Statistics */}
                {activePreview && (
                  <div className="lg:col-span-5 rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4">
                    <h2 className="text-sm font-semibold text-white">
                      02. Pairing Eligibility Preview
                    </h2>
                    <dl className="divide-y divide-white/10 text-xs">
                      <div className="flex justify-between py-2.5">
                        <dt className="text-slate-400">Total Eligible Guests</dt>
                        <dd className="font-mono-tabular font-semibold text-white">
                          {activePreview.totalEligible}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-slate-400">Already Locked (Protected)</dt>
                        <dd className="font-mono-tabular font-semibold text-emerald-400">
                          {activePreview.alreadyLockedGivers}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-slate-400">Available Unlocked Pool</dt>
                        <dd className="font-mono-tabular font-semibold text-[#E5B84B]">
                          {activePreview.availableToPair}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-slate-400">Predicted New Assignments</dt>
                        <dd className="font-mono-tabular font-semibold text-white">
                          {activePreview.predictedNewPairs}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-slate-400">Predicted Unpaired Queue</dt>
                        <dd className="font-mono-tabular font-semibold text-amber-300">
                          {activePreview.predictedUnpairedQueue}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>

              {/* Batches Review & Lock Controls */}
              {pairingsData.batches.length > 0 && (
                <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-white">Pairing Batches</h3>
                  <div className="divide-y divide-white/10">
                    {pairingsData.batches.map((b) => (
                      <div
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <p className="font-semibold text-white">
                            Batch #{b.id} · {b.pairing_mode === 'MUTUAL' ? 'Mutual Pairing' : 'Secret Gift Exchange'}
                          </p>
                          <p className="text-slate-400 font-mono-tabular">
                            {b.total_paired} assignments · {b.total_queued} queued · Status:{' '}
                            <span className={b.status === 'LOCKED' ? 'text-emerald-400' : 'text-[#E5B84B]'}>
                              {b.status}
                            </span>
                          </p>
                        </div>

                        {b.status !== 'LOCKED' ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleLockBatch(b.id)}
                              disabled={pairingBusy}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                            >
                              <Lock className="h-3.5 w-3.5" />
                              Confirm & Lock Batch
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDiscardBatch(b.id)}
                              disabled={pairingBusy}
                              className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                            >
                              Discard Draft
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                            <Lock className="h-3.5 w-3.5" />
                            Locked Permanently
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pairings Table + Swap Reassignment */}
              <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-5">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Generated Gift Assignments ({pairingsData.pairings.length})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Select any two rows to swap recipients or unlink a withdrawn guest
                    </p>
                  </div>
                  {swapSelection.length === 2 && (
                    <button
                      type="button"
                      onClick={handleSwapSelected}
                      disabled={pairingBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5B84B] px-3.5 py-2 text-xs font-semibold text-[#0A0704] cursor-pointer"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Swap Selected Recipients
                    </button>
                  )}
                </div>

                {pairingsData.pairings.length === 0 ? (
                  <p className="p-8 text-center text-xs text-slate-400">
                    No gift assignments generated yet. Confirm eligible participants and click Generate Draft Pairings above.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E5B84B]/20 bg-[#0A0805] text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Swap</th>
                          <th className="px-4 py-3 font-semibold">Giver</th>
                          <th className="px-4 py-3 font-semibold">Assigned Recipient</th>
                          <th className="px-4 py-3 font-semibold">Mode</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold text-right">Reassign</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {pairingsData.pairings.map((row) => {
                          const checked = swapSelection.includes(row.id);
                          const hasAlert =
                            row.giver_attendance !== 'CONFIRMED' ||
                            row.giver_consent !== 1 ||
                            row.recipient_attendance !== 'CONFIRMED' ||
                            row.recipient_consent !== 1;
                          return (
                            <tr key={row.id} className="hover:bg-white/[0.03]">
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSwapSelection((prev) =>
                                      prev.includes(row.id)
                                        ? prev.filter((id) => id !== row.id)
                                        : prev.length >= 2
                                          ? [prev[1], row.id]
                                          : [...prev, row.id]
                                    );
                                  }}
                                  className="h-4 w-4 accent-[#D4AF37]"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-white">{row.giver_name}</div>
                                <div className="font-mono-tabular text-[11px] text-slate-400">
                                  {row.giver_ref}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-[#E5B84B]">{row.recipient_name}</div>
                                <div className="font-mono-tabular text-[11px] text-slate-400">
                                  {row.recipient_ref}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-300">{row.pairing_mode}</td>
                              <td className="px-4 py-3">
                                {hasAlert ? (
                                  <span className="text-amber-400 font-semibold">
                                    Withdrawal Alert
                                  </span>
                                ) : row.is_locked === 1 ? (
                                  <span className="text-emerald-400 font-medium">Locked</span>
                                ) : (
                                  <span className="text-[#E5B84B] font-medium">Draft</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkParticipant(row.giver_id)}
                                  className="inline-flex items-center gap-1 rounded border border-white/15 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer"
                                >
                                  <Unlink className="h-3 w-3" />
                                  Unlink
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Unpaired Queue + Controlled Manual Pair */}
              {pairingsData.unpairedEligible.length > 0 && (
                <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Unpaired Eligible Queue ({pairingsData.unpairedEligible.length})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Eligible confirmed participants waiting for an available match
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs">
                    {pairingsData.unpairedEligible.map((u) => (
                      <div
                        key={u.id}
                        className="rounded-lg border border-white/10 bg-[#080604] px-3 py-2"
                      >
                        <span className="font-medium text-white">{u.full_name}</span>
                        <span className="ml-2 font-mono-tabular text-slate-400">
                          {u.registration_reference}
                        </span>
                      </div>
                    ))}
                  </div>

                  {pairingsData.unpairedEligible.length >= 2 && (
                    <form
                      onSubmit={handleManualPair}
                      className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-4 sm:items-end"
                    >
                      <div>
                        <label className="block text-[11px] text-slate-400">Giver</label>
                        <select
                          value={manualGiverId}
                          onChange={(e) => setManualGiverId(Number(e.target.value) || '')}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                        >
                          <option value="">Select giver...</option>
                          {pairingsData.unpairedEligible.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} ({u.registration_reference})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400">Recipient</label>
                        <select
                          value={manualRecipientId}
                          onChange={(e) => setManualRecipientId(Number(e.target.value) || '')}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                        >
                          <option value="">Select recipient...</option>
                          {pairingsData.unpairedEligible.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} ({u.registration_reference})
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-200 pb-2">
                        <input
                          type="checkbox"
                          checked={manualMutual}
                          onChange={(e) => setManualMutual(e.target.checked)}
                          className="h-4 w-4 accent-[#D4AF37]"
                        />
                        Mutual pair (both ways)
                      </label>
                      <button
                        type="submit"
                        disabled={pairingBusy || !manualGiverId || !manualRecipientId}
                        className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] disabled:opacity-40 cursor-pointer"
                      >
                        Create Locked Pair
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==============================================================
           * TAB 5: REPORTS & EXPORTS
           * ============================================================ */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="no-print flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-3xl font-semibold text-white">
                    Reports & Exports
                  </h1>
                  <p className="text-xs text-slate-400">
                    Download CSV or Excel-compatible workbooks and print complete pairing reports
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Complete Report
                </button>
              </div>

              <div className="no-print grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Participant Directory Export
                  </h2>
                  <p className="text-xs text-slate-300">
                    Includes Registration Reference, Full Name, Phone, Email,
                    Residence, Attendance Status, Gift Consent, Pairing Status, and
                    Registration Date.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="/api/admin/export/participants?format=csv"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download CSV
                    </a>
                    <a
                      href="/api/admin/export/participants?format=xls"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Excel (.xls)
                    </a>
                  </div>
                </div>

                <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Complete Pairing Report Export
                  </h2>
                  <p className="text-xs text-slate-300">
                    Full audit-ready giver-to-recipient mapping with batch IDs,
                    pairing modes, lock timestamps, and contact numbers.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="/api/admin/export/pairings?format=csv"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download CSV
                    </a>
                    <a
                      href="/api/admin/export/pairings?format=xls"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Excel (.xls)
                    </a>
                  </div>
                </div>
              </div>

              {/* Complete Pairing Report Table */}
              <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4">
                <div className="border-b border-white/10 pb-3">
                  <h3 className="font-display text-2xl font-semibold text-white">
                    {overview?.event.eventName} — Master Pairing Report
                  </h3>
                  <p className="text-xs text-slate-400 tabular-nums">
                    {pairingsData?.pairings.length || 0} active pairing(s) ·{' '}
                    {stats?.confirmedAttendees || 0} confirmed attendees
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/10 text-slate-400">
                      <tr>
                        <th className="py-2.5 pr-4">Batch</th>
                        <th className="py-2.5 pr-4">Giver</th>
                        <th className="py-2.5 pr-4">Recipient</th>
                        <th className="py-2.5 pr-4">Mode</th>
                        <th className="py-2.5">Lock Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {(pairingsData?.pairings || []).map((row) => (
                        <tr key={row.id}>
                          <td className="py-2.5 pr-4 font-mono-tabular text-slate-400">
                            #{row.pairing_batch_id}
                          </td>
                          <td className="py-2.5 pr-4 text-white">
                            {row.giver_name} ({row.giver_ref})
                          </td>
                          <td className="py-2.5 pr-4 text-[#E5B84B]">
                            {row.recipient_name} ({row.recipient_ref})
                          </td>
                          <td className="py-2.5 pr-4 text-slate-300">{row.pairing_mode}</td>
                          <td className="py-2.5 text-slate-300">
                            {row.is_locked === 1 ? 'Locked' : 'Draft'}
                          </td>
                        </tr>
                      ))}
                      {(pairingsData?.pairings.length || 0) === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-400">
                            No pairings generated yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==============================================================
           * TAB 6: EVENT SETTINGS
           * ============================================================ */}
          {activeTab === 'event' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-semibold text-white">
                  Event Settings
                </h1>
                <p className="text-xs text-slate-400">
                  Configure the dinner details, registration deadline, and Google Form link
                </p>
              </div>

              <form
                onSubmit={handleSaveEventSettings}
                className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Organizer / Association Name
                    </label>
                    <input
                      type="text"
                      required
                      value={evOrganizer}
                      onChange={(e) => setEvOrganizer(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Event Name
                    </label>
                    <input
                      type="text"
                      required
                      value={evName}
                      onChange={(e) => setEvName(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Dinner Date & Time
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={evDate}
                      onChange={(e) => setEvDate(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Registration Deadline
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={evDeadline}
                      onChange={(e) => setEvDeadline(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Venue Address
                    </label>
                    <input
                      type="text"
                      required
                      value={evVenue}
                      onChange={(e) => setEvVenue(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      RSVP / Ticket Inquiry Phone
                    </label>
                    <input
                      type="text"
                      value={evContactPhone}
                      onChange={(e) => setEvContactPhone(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 font-mono-tabular text-sm text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-stone-300">
                      Ticket Pricing Summary
                    </label>
                    <input
                      type="text"
                      value={evTicketInfo}
                      onChange={(e) => setEvTicketInfo(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Dress Code
                    </label>
                    <input
                      type="text"
                      value={evDressCode}
                      onChange={(e) => setEvDressCode(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Gift Budget Guidance
                    </label>
                    <input
                      type="text"
                      value={evBudget}
                      onChange={(e) => setEvBudget(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Event Status
                    </label>
                    <select
                      value={evStatus}
                      onChange={(e) => setEvStatus(e.target.value as EventStatus)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-sm text-white"
                    >
                      <option value="OPEN">OPEN (Accepting Registrations)</option>
                      <option value="CLOSED">CLOSED (Registration Cutoff)</option>
                      <option value="COMPLETED">COMPLETED</option>
                    </select>
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2.5 text-xs font-medium text-stone-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={evAllowUpdates}
                        onChange={(e) => setEvAllowUpdates(e.target.checked)}
                        className="h-4 w-4 accent-[#E5B84B]"
                      />
                      Allow participants to update unlocked attendance online
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Linked Google Form ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={evGoogleFormId}
                      onChange={(e) => setEvGoogleFormId(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-xs font-mono-tabular text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-300">
                      Linked Google Form Public URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={evGoogleFormUrl}
                      onChange={(e) => setEvGoogleFormUrl(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2.5 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={savingEvent}
                    className="rounded-lg bg-[#E5B84B] px-5 py-2.5 text-xs font-semibold text-[#0A0704] hover:bg-[#E5C158] disabled:opacity-50 cursor-pointer"
                  >
                    {savingEvent ? 'Saving Settings...' : 'Save Event Settings'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ==============================================================
           * TAB 7: ADMINISTRATOR SETTINGS & AUDIT LOGS
           * ============================================================ */}
          {activeTab === 'settings' && adminSettings && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-semibold text-white">
                  Administrator Settings & Audit Log
                </h1>
                <p className="text-xs text-slate-400">
                  Manage authorized event administrators, update passwords, and inspect security logs
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Change Password */}
                <form
                  onSubmit={handleChangePassword}
                  className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4"
                >
                  <h2 className="text-sm font-semibold text-white">
                    Change Your Password
                  </h2>
                  <div>
                    <label className="block text-xs text-slate-400">Current Password</label>
                    <input
                      type="password"
                      required
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">
                      New Password (min 8 chars)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={nextPw}
                      onChange={(e) => setNextPw(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-semibold text-[#0A0704] cursor-pointer"
                  >
                    Update Password
                  </button>
                </form>

                {/* Add Admin (Super Admin Only) */}
                <form
                  onSubmit={handleCreateAdmin}
                  className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-4"
                >
                  <h2 className="text-sm font-semibold text-white">
                    Add Authorized Administrator
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-slate-400">Username</label>
                      <input
                        type="text"
                        required
                        value={newAdminUsername}
                        onChange={(e) => setNewAdminUsername(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Google / Email</label>
                      <input
                        type="email"
                        required
                        value={newAdminEmail}
                        onChange={(e) => setNewAdminEmail(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Password</label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newAdminPassword}
                        onChange={(e) => setNewAdminPassword(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Role</label>
                      <select
                        value={newAdminRole}
                        onChange={(e) =>
                          setNewAdminRole(e.target.value as 'ADMIN' | 'SUPER_ADMIN')
                        }
                        className="mt-1 w-full rounded-lg border border-white/15 bg-[#080604] px-3 py-2 text-xs text-white"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="SUPER_ADMIN">Super Admin</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={admin.role !== 'SUPER_ADMIN'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Administrator
                  </button>
                </form>
              </div>

              {/* Active Admins List */}
              <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Authorized Administrators ({adminSettings.administrators.length})
                </h3>
                <div className="divide-y divide-white/10 text-xs">
                  {adminSettings.administrators.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="font-semibold text-white">{a.username}</span>
                        <span className="ml-2 text-slate-400">{a.email}</span>
                        <span className="ml-2 text-[#E5B84B]">· {a.role}</span>
                      </div>
                      {admin.role === 'SUPER_ADMIN' && a.id !== admin.id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteAdmin(a.id)}
                          className="text-rose-300 hover:text-rose-200 underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Immutable Audit Log */}
              <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 overflow-hidden">
                <div className="border-b border-white/10 px-6 py-4">
                  <h3 className="text-sm font-semibold text-white">
                    Security & Activity Audit Log
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E5B84B]/20 bg-[#0A0805] text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Timestamp</th>
                        <th className="px-4 py-2.5">Admin</th>
                        <th className="px-4 py-2.5">Action</th>
                        <th className="px-4 py-2.5">Record</th>
                        <th className="px-4 py-2.5">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {adminSettings.auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="px-4 py-2.5 font-mono-tabular text-slate-400 whitespace-nowrap">
                            {log.timestamp}
                          </td>
                          <td className="px-4 py-2.5 text-white">{log.administrator_label}</td>
                          <td className="px-4 py-2.5 font-mono-tabular text-[#E5B84B]">
                            {log.action}
                          </td>
                          <td className="px-4 py-2.5 text-slate-200">{log.affected_record}</td>
                          <td className="px-4 py-2.5 text-slate-400">{log.details || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Add / Edit Participant Modal */}
      {participantModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#E5B84B]/50 bg-[#100C07] p-6 text-[#FBF7EE] shadow-2xl space-y-5">
            <div className="border-b border-[#E5B84B]/20 pb-3">
              <h3 className="font-display text-2xl font-semibold text-white">
                {editingParticipant
                  ? `Edit ${editingParticipant.registrationReference}`
                  : 'Add New Participant'}
              </h3>
            </div>
            <form onSubmit={handleSaveParticipant} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Telephone / WhatsApp
                  </label>
                  <input
                    type="tel"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Residence / Location
                  </label>
                  <input
                    type="text"
                    required
                    value={formResidence}
                    onChange={(e) => setFormResidence(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Ticket Category
                  </label>
                  <select
                    value={formTicketCategory}
                    onChange={(e) => setFormTicketCategory(e.target.value as TicketCategory)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  >
                    <option value="STUDENT">Student (UGX 50,000)</option>
                    <option value="ALUMNI">Alumni (UGX 70,000)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Attendance
                  </label>
                  <select
                    value={formAttendance}
                    onChange={(e) => setFormAttendance(e.target.value as AttendanceStatus)}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  >
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="PENDING">Pending</option>
                    <option value="DECLINED">Declined</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#F5D67B]">
                    Gift Exchange Consent
                  </label>
                  <select
                    value={formConsent ? 'yes' : 'no'}
                    onChange={(e) => setFormConsent(e.target.value === 'yes')}
                    className="mt-1 w-full rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3 py-2 text-sm text-white"
                  >
                    <option value="yes">Yes, agrees to participate</option>
                    <option value="no">No, opted out</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setParticipantModalOpen(false)}
                  className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-stone-200 hover:bg-white/10 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingParticipant}
                  className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-bold text-[#0A0704] hover:bg-[#F2CE6B] cursor-pointer"
                >
                  {savingParticipant ? 'Saving...' : 'Save Participant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issued OTP Modal */}
      {issuedOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#111C33] p-6 text-white shadow-2xl space-y-4">
            <h3 className="font-display text-2xl font-semibold">
              One-Time Access Code Issued
            </h3>
            <p className="text-xs text-slate-300">
              Share this 6-digit verification code securely with{' '}
              <span className="font-semibold text-white">{issuedOtpModal.fullName}</span>{' '}
              ({issuedOtpModal.phoneNumber}) so they can view their private assignment.
            </p>
            <div className="rounded-xl border border-[#D4AF37]/40 bg-[#080604] p-4 text-center">
              <p className="text-xs text-slate-400">
                Ref {issuedOtpModal.registrationReference} · Valid {issuedOtpModal.expiresInMinutes} mins
              </p>
              <p className="mt-1 font-mono-tabular text-3xl font-semibold tracking-widest text-[#E5B84B]">
                {issuedOtpModal.code}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `Dinner Pair Access — Ref: ${issuedOtpModal.registrationReference}, Verification Code: ${issuedOtpModal.code}`
                  );
                  setCopiedOtp(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-4 py-2 text-xs font-semibold text-[#0B1324] cursor-pointer"
              >
                {copiedOtp ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedOtp ? 'Copied Message' : 'Copy WhatsApp Message'}
              </button>
              <button
                type="button"
                onClick={() => setIssuedOtpModal(null)}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
