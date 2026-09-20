// Wallet Court — Calibration Candidate DB helpers. Server-side only. Reads/writes
// the CalibrationCandidate entity via the service role (bypasses RLS). Never
// stores secrets or raw Nansen labels beyond what the entity already holds.

const MAX_CANDIDATES = 500;

// List all candidates, newest first.
export async function getCandidates(base44): Promise<any[]> {
  const records = await base44.asServiceRole.entities.CalibrationCandidate.list("-created_at", MAX_CANDIDATES);
  return records || [];
}

// Get a single candidate by candidate_id.
export async function getCandidateById(base44, candidateId: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities.CalibrationCandidate.filter(
    { candidate_id: candidateId }, "-created_at", 1
  );
  return (records && records[0]) || null;
}

// Bulk create candidates.
export async function createCandidates(base44, candidates: any[]): Promise<any[]> {
  if (!candidates || candidates.length === 0) return [];
  const result = await base44.asServiceRole.entities.CalibrationCandidate.bulkCreate(candidates);
  return Array.isArray(result) ? result : (result?.length ? result : []);
}

// CAS update of candidate review status. Returns the updated record or null
// if the CAS failed (version mismatch).
export async function updateCandidateStatus(
  base44,
  candidateId: string,
  expectedVersion: number,
  newStatus: string,
  skipReason: string | null
): Promise<any | null> {
  const result = await base44.asServiceRole.entities.CalibrationCandidate.updateMany(
    {
      candidate_id: candidateId,
      version: expectedVersion
    },
    {
      $set: {
        review_status: newStatus,
        skip_reason: skipReason,
        updated_at: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  );
  if (!result || result.updated !== 1) return null;
  // Re-read the updated record
  const records = await base44.asServiceRole.entities.CalibrationCandidate.filter(
    { candidate_id: candidateId }, "-created_at", 1
  );
  return (records && records[0]) || null;
}

// Collect wallet_fingerprint values from all existing candidates.
export async function getExistingCandidateFingerprints(base44): Promise<Set<string>> {
  const records = await base44.asServiceRole.entities.CalibrationCandidate.list(MAX_CANDIDATES);
  const set = new Set<string>();
  for (const r of records || []) {
    if (r.wallet_fingerprint) set.add(r.wallet_fingerprint);
  }
  return set;
}