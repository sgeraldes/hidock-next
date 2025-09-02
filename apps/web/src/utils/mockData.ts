import type { AudioRecording, HiDockDevice } from '@/types';

export const mockDevice: HiDockDevice = {
  id: 'hidock-001',
  name: 'HiDock H1',
  model: 'HiDock H1 Pro',
  serialNumber: 'HD001234567',
  firmwareVersion: '1.2.3',
  connected: true,
  storageInfo: {
    totalCapacity: 8 * 1024 * 1024 * 1024, // 8GB
    usedSpace: 150 * 1024 * 1024, // 150MB
    freeSpace: (8 * 1024 * 1024 * 1024) - (150 * 1024 * 1024),
    fileCount: 12,
  },
};

export const mockRecordings: AudioRecording[] = [
  {
    id: 'rec-001',
    fileName: 'meeting_2024-01-15_morning.wav',
    size: 25 * 1024 * 1024, // 25MB
    duration: 1800, // 30 minutes
    dateCreated: new Date('2024-01-15T09:30:00'),
    status: 'on_device',
  },
  {
    id: 'rec-002',
    fileName: 'interview_candidate_john.wav',
    size: 18 * 1024 * 1024, // 18MB
    duration: 1200, // 20 minutes
    dateCreated: new Date('2024-01-14T14:15:00'),
    status: 'downloaded',
    localPath: '/downloads/interview_candidate_john.wav',
  },
  {
    id: 'rec-003',
    fileName: 'brainstorm_session_q1.wav',
    size: 32 * 1024 * 1024, // 32MB
    duration: 2400, // 40 minutes
    dateCreated: new Date('2024-01-13T16:45:00'),
    status: 'transcribed',
    localPath: '/downloads/brainstorm_session_q1.wav',
    transcription: 'Today we discussed the Q1 roadmap and identified key priorities for the upcoming quarter...',
    insights: {
      summary: 'Team brainstorming session focused on Q1 planning and priority setting.',
      keyPoints: [
        'Identified three main product features for Q1',
        'Discussed resource allocation and timeline',
        'Agreed on weekly check-in meetings'
      ],
      sentiment: 'Positive',
      actionItems: [
        'Create detailed project timeline by Friday',
        'Assign team leads to each feature',
        'Schedule weekly progress reviews'
      ],
      topics: ['Q1 Planning', 'Product Features', 'Resource Management'],
      speakers: ['Alice', 'Bob', 'Charlie'],
    },
  },
  {
    id: 'rec-004',
    fileName: 'client_call_acme_corp.wav',
    size: 15 * 1024 * 1024, // 15MB
    duration: 900, // 15 minutes
    dateCreated: new Date('2024-01-12T11:00:00'),
    status: 'downloaded',
    localPath: '/downloads/client_call_acme_corp.wav',
  },
  {
    id: 'rec-005',
    fileName: 'standup_monday.wav',
    size: 8 * 1024 * 1024, // 8MB
    duration: 480, // 8 minutes
    dateCreated: new Date('2024-01-11T09:00:00'),
    status: 'on_device',
  },
  {
    id: 'rec-006',
    fileName: 'presentation_rehearsal.wav',
    size: 45 * 1024 * 1024, // 45MB
    duration: 3600, // 60 minutes
    dateCreated: new Date('2024-01-10T15:30:00'),
    status: 'transcribed',
    localPath: '/downloads/presentation_rehearsal.wav',
    transcription: 'Good afternoon everyone. Today I want to walk you through our new product strategy...',
    insights: {
      summary: 'Presentation rehearsal covering new product strategy and market positioning.',
      keyPoints: [
        'New product strategy overview',
        'Market analysis and competitive landscape',
        'Go-to-market timeline and milestones'
      ],
      sentiment: 'Neutral',
      actionItems: [
        'Refine slide deck based on feedback',
        'Prepare demo for key features',
        'Schedule practice session with stakeholders'
      ],
      topics: ['Product Strategy', 'Market Analysis', 'Presentation'],
      speakers: ['Sarah'],
    },
  },
];

export const generateMockAudioUrl = (recordingId: string): string => {
  // Generate a mock audio URL for testing
  // In a real app, this would be the actual file URL or blob URL
  return `data:audio/wav;base64,${btoa(`mock-audio-data-${recordingId}`)}`;
};

export const getMockInsights = (_transcription: string) => {
  return {
    summary: 'This is a mock summary of the transcribed content for demonstration purposes.',
    keyPoints: [
      'First key point extracted from the transcription',
      'Second important discussion topic',
      'Third notable mention or decision'
    ],
    sentiment: 'Positive' as const,
    actionItems: [
      'Follow up on discussed items',
      'Schedule next meeting',
      'Prepare required documents'
    ],
    topics: ['Meeting', 'Discussion', 'Planning'],
    speakers: ['Speaker 1', 'Speaker 2'],
  };
};
