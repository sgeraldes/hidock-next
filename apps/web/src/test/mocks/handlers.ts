import { http, HttpResponse } from 'msw'

export const handlers = [
    // Mock Gemini API
    http.post('https://generativelanguage.googleapis.com/v1beta/models/*', () => {
        return HttpResponse.json({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                text: JSON.stringify({
                                    transcription: 'This is a mock transcription.',
                                    summary: 'Mock summary',
                                    keyPoints: ['Point 1', 'Point 2'],
                                    sentiment: 'Positive'
                                })
                            }
                        ]
                    }
                }
            ]
        })
    }),

    // Mock other API endpoints as needed
    http.get('/api/health', () => {
        return HttpResponse.json({ status: 'ok' })
    }),
]
