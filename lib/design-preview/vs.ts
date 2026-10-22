/**
 * Design-preview fixtures for the VS detail page.
 *
 * This module is dynamically imported by
 * `app[/locale]/vs/[id]/page.tsx` only when preview mode is active,
 * so mock opponents and fake rematch chains are excluded from the
 * production bundle for normal page loads.
 *
 * How to enable the preview:
 *   - Add `?preview=design` in the query string, or
 *   - set the `designPreview` flag (e.g. cookie / env) that the page
 *     reads to decide whether to dynamically import this module.
 *
 * The builders are pure and deterministic for a given base so they
 * can be unit-tested without any network or time dependencies.
 */

export type DesignPreviewSide = {
  id: string;
  name: string;
  avatarUrl?: string;
  score?: number;
  isWinner?: boolean;
};

export type DesignPreviewVs = {
  id: string;
  mode: '1v1' | 'team';
  challenger: DesignPreviewSide;
  opponent: DesignPreviewSide;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
};

export type DesignPreviewRematchChain = {
  baseId: string;
  links: Array<{
    id: string;
    fromId: string;
    toId: string;
    label: string;
  }>;
};

export const DESIGN_PREVIEW_OPPONENT: DesignPreviewSide = {
  id: 'design-preview-opponent',
  name: 'Opponent (Preview)',
  score: 7,
};

export const DESIGN_PREVIEW_CHALLENGER_2: DesignPreviewSide = {
  id: 'design-preview-challenger-2',
  name: 'Challenger 2 (Preview)',
  score: 5,
};

export const DESIGN_PREVIEW_CHALLENGER_3: DesignPreviewSide = {
  id: 'design-preview-challenger-3',
  name: 'Challenger 3 (Preview)',
  score: 3,
};

export function isDesignPreviewOneVsOneBase(base: { id?: string; mode?: string }): boolean {
  if (!base) {
    return false;
  }
  return base.mode === '1v1' || base.id === 'design-preview-1v1';
}

export function buildDesignPreviewVs(base: {
  id?: string;
  mode?: '1v1' | 'team';
  challenger?: DesignPreviewSide;
  opponent?: DesignPreviewSide;
  status?: DesignPreviewVs['status'];
  createdAt?: string;
}): DesignPreviewVs {
  const id = base.id ?? 'design-preview-1v1';
  const mode = base.mode ?? '1v1';
  const challenger: DesignPreviewSide = base.challenger ?? {
    id: 'design-preview-challenger',
    name: 'Challenger (Preview)',
    score: 9,
  };
  const opponent = base.opponent ?? DESIGN_PREVIEW_OPPONENT;
  const status = base.status ?? 'in_progress';
  const createdAt = base.createdAt ?? '2024-01-01T00:00:00.000Z';

  return {
    id,
    mode,
    challenger,
    opponent,
    status,
    createdAt,
  };
}

export function buildDesignPreviewRematchChain(base: {
  id?: string;
}): DesignPreviewRematchChain {
  const baseId = base.id ?? 'design-preview-1v1';
  const links = [
    {
      id: `${baseId}-rematch-2`,
      fromId: baseId,
      toId: DESIGN_PREVIEW_CHALLENGER_2.id,
      label: 'Rematch 2',
    },
    {
      id: `${baseId}-rematch-3`,
      fromId: DESIGN_PREVIEW_CHALLENGER_2.id,
      toId: DESIGN_PREVIEW_CHALLENGER_3.id,
      label: 'Rematch 3',
    },
  ];

  return { baseId, links };
}
