export interface NextCut {
  level: string;
  time: string;
  needed: number; // seconds to drop
}

export interface SwimEvent {
  event: number;
  race: string;
  desc: string;
  heat: string | null;
  lane: number;
  seed: string;
  achieved?: string | null;
  nextCut?: NextCut | null;
  ladder?: Record<string, string>;
}

export interface MeetDay {
  meet: string;
  swimmer: { name: string | null; age: string | null; team: string | null };
  course: string;
  standardsSet: string;
  events: SwimEvent[];
}
