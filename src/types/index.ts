export type AttendanceStatus = 'CONFIRMED' | 'PENDING' | 'DECLINED';
export type TicketCategory = 'STUDENT' | 'ALUMNI';
export type PairingMode = 'MUTUAL' | 'SECRET';
export type EventStatus = 'OPEN' | 'CLOSED' | 'COMPLETED';

export interface PublicEventInfo {
  id: number;
  organizerName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  dressCode: string;
  giftBudget: string;
  ticketInfo: string;
  contactPhone: string;
  registrationDeadline: string;
  eventStatus: EventStatus;
  allowAttendanceUpdates: boolean;
  googleFormId?: string | null;
  googleFormUrl?: string | null;
}

export interface PublicEventResponse {
  event: PublicEventInfo;
  summary: {
    totalRegistrations: number;
    confirmedCount: number;
    pairingsPublished: boolean;
  };
}

export interface RegistrationReceipt {
  registrationReference: string;
  fullName: string;
  ticketCategory: TicketCategory;
  attendanceStatus: AttendanceStatus;
  giftExchangeConsent: boolean;
  personalAccessCode: string;
  eventName: string;
  eventDate: string;
  venue: string;
}

export interface AssignmentVerificationResponse {
  participant: {
    registrationReference: string;
    fullName: string;
    ticketCategory: TicketCategory;
    attendanceStatus: AttendanceStatus;
    giftExchangeConsent: boolean;
  };
  assignment: {
    assignedRecipientName: string;
    pairingMode: PairingMode;
    lockedAt: string;
  } | null;
  event: Omit<PublicEventInfo, 'id'>;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
}

export interface OverviewStats {
  totalRegistrations: number;
  confirmedAttendees: number;
  pendingConfirmations: number;
  unableToAttend: number;
  giftExchangeParticipants: number;
  optedOutOfGifting: number;
  eligibleForPairing: number;
  successfullyPaired: number;
  lockedPairings: number;
  unpairedEligible: number;
}

export interface WithdrawnAlert {
  pairingId: number;
  isLocked: number;
  giverId: number;
  giverName: string;
  giverAttendance: AttendanceStatus;
  giverConsent: number;
  recipientId: number;
  recipientName: string;
  recipientAttendance: AttendanceStatus;
  recipientConsent: number;
}

export interface DailyTrendPoint {
  day: string;
  count: number;
}

export interface OverviewResponse {
  event: PublicEventInfo;
  stats: OverviewStats;
  withdrawnAlerts: WithdrawnAlert[];
  dailyTrend: DailyTrendPoint[];
}

export interface ParticipantRecord {
  id: number;
  registrationReference: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  residence: string;
  ticketCategory: TicketCategory;
  attendanceStatus: AttendanceStatus;
  giftExchangeConsent: boolean;
  source: string;
  pairingStatus: 'LOCKED' | 'DRAFT' | 'UNPAIRED' | 'INELIGIBLE';
  pairingMode: PairingMode | null;
  assignedRecipientName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PairingBatchRecord {
  id: number;
  pairing_mode: PairingMode;
  total_eligible: number;
  total_paired: number;
  total_queued: number;
  status: 'DRAFT' | 'CONFIRMED' | 'LOCKED';
  created_at: string;
  locked_at: string | null;
}

export interface PairingRecord {
  id: number;
  pairing_batch_id: number;
  pairing_mode: PairingMode;
  is_locked: number;
  created_at: string;
  locked_at: string | null;
  giver_id: number;
  giver_ref: string;
  giver_name: string;
  giver_attendance: AttendanceStatus;
  giver_consent: number;
  recipient_id: number;
  recipient_ref: string;
  recipient_name: string;
  recipient_attendance: AttendanceStatus;
  recipient_consent: number;
}

export interface PairingPreview {
  mode: PairingMode;
  totalEligible: number;
  alreadyLockedGivers: number;
  availableToPair: number;
  predictedNewPairs: number;
  predictedUnpairedQueue: number;
  hasUnlockedDraft: boolean;
  canGenerate: boolean;
  reason?: string;
}

export interface PairingsResponse {
  preview: PairingPreview;
  previews: {
    MUTUAL: PairingPreview;
    SECRET: PairingPreview;
  };
  batches: PairingBatchRecord[];
  pairings: PairingRecord[];
  unpairedEligible: Array<{
    id: number;
    registration_reference: string;
    full_name: string;
    residence: string;
    phone_number: string;
  }>;
}

export interface AuditLogRecord {
  id: number;
  administrator_label: string;
  action: string;
  affected_record: string;
  details: string | null;
  timestamp: string;
}

export interface AdminSettingsResponse {
  administrators: Array<AdminUser & { created_at: string }>;
  auditLogs: AuditLogRecord[];
}
