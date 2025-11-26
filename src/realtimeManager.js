/**
 * RealtimeManager - OpenAI Realtime API WebSocket Manager
 * Handles connection, session management, and event routing
 */
export class RealtimeManager {
  constructor(serverUrl = "ws://localhost:3000/realtime") {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;

    // Callbacks
    this.onConnected = null;
    this.onDisconnected = null;
    this.onError = null;
    this.onSessionCreated = null;
    this.onSessionUpdated = null;
    this.onResponseStarted = null;
    this.onAudioDelta = null;
    this.onResponseDone = null;
    this.onTranscriptDelta = null;
    this.onTranscriptDone = null;
  }

  /**
   * Connect to Realtime API via backend proxy
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log("🔌 Connecting to Realtime API...");

        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log("✅ Connected to Realtime API");
          this.isConnected = true;
          this.onConnected?.();
          resolve();
        };

        this.ws.onmessage = async (event) => {
          try {
            let data;

            if (event.data instanceof Blob) {
              const text = await event.data.text();
              data = JSON.parse(text);
            } else {
              data = JSON.parse(event.data);
            }

            this.handleServerEvent(data);
          } catch (error) {
            console.error("❌ Error parsing message:", error);
            console.log("Raw message:", event.data);
          }
        };

        this.ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error);
          this.onError?.(error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("🔌 Disconnected from Realtime API");
          this.isConnected = false;
          this.sessionId = null;
          this.onDisconnected?.();
        };
      } catch (error) {
        console.error("❌ Connection error:", error);
        reject(error);
      }
    });
  }

  /**
   * Handle server events from Realtime API
   */
  handleServerEvent(event) {
    console.log("📨 Server event:", event.type);

    switch (event.type) {
      case "session.created":
        this.sessionId = event.session.id;
        console.log("✅ Session created:", this.sessionId);
        this.onSessionCreated?.(event.session);
        break;

      case "session.updated":
        console.log("✅ Session updated");
        console.log("Session details:", JSON.stringify(event.session, null, 2));
        this.onSessionUpdated?.(event.session);
        break;

      case "response.created":
        console.log("🎤 Response started");
        this.onResponseStarted?.(event.response);
        break;

      case "response.output_audio.delta":
        // Audio chunk received
        this.onAudioDelta?.(event.delta);
        break;

      case "response.output_audio_transcript.delta":
        // Transcript chunk received
        this.onTranscriptDelta?.(event.delta);
        break;

      case "response.output_audio_transcript.done":
        // Full transcript received
        console.log("📝 Transcript done:", event.transcript);
        this.onTranscriptDone?.(event.transcript);
        break;

      case "response.done":
        console.log("✅ Response completed");
        this.onResponseDone?.(event.response);
        break;

      case "error":
        console.error("❌ Realtime API error:", event.error);
        console.error("Full error object:", JSON.stringify(event, null, 2));
        this.onError?.(event.error);
        break;

      default:
        // Other events (for debugging)
        // console.log("📨 Unhandled event:", event.type);
        break;
    }
  }

  /**
   * Initialize session with instructions and voice
   */
  initializeSession(language = "ko-KR") {
    const voice = language === "ko-KR" ? "shimmer" : "nova";

    const instructions = `You are an empathetic AI counselor. 
  
  Guidelines:
  - Respond with warmth and understanding (2-3 sentences)
  - Match the user's language (Korean or English)
  - Show genuine care and validation
  - Keep responses natural and conversational
  
  Language:
  - Respond in the same language as the user
  - For Korean input, respond in Korean
  - For English input, respond in English`;

    const event = {
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime",
        modalities: ["text", "audio"],
        instructions: instructions,
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            turn_detection: null,
          },
          output: {
            format: {
              type: "audio/pcm",
            },
            voice: voice,
          },
        },
        temperature: 0.8,
        max_response_output_tokens: 4096,
      },
    };

    console.log("📤 Session update:", JSON.stringify(event, null, 2));

    this.send(event);
    console.log(`🎙️ Session initialized with voice: ${voice}`);
  }

  /**
   * Send text message to Realtime API
   */
  sendText(text, emotion = "neutral") {
    if (!this.isConnected) {
      console.error("❌ Not connected to Realtime API");
      return;
    }

    console.log("📤 Sending text:", text);
    console.log("📤 With emotion:", emotion);

    // Add emotion context to instructions if needed
    const emotionContext =
      emotion !== "neutral"
        ? `\n\nIMPORTANT: Respond with a ${emotion} tone to match the empathetic expression shown on your avatar.`
        : "";

    // Create conversation item
    const itemEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: text + emotionContext,
          },
        ],
      },
    };

    // Request response
    const responseEvent = {
      type: "response.create",
    };

    console.log("📤 Item event:", JSON.stringify(itemEvent, null, 2));
    console.log("📤 Response event:", JSON.stringify(responseEvent, null, 2));

    this.send(itemEvent);
    this.send(responseEvent);

    console.log("📤 Text sent to Realtime API");
  }

  /**
   * Send event to server
   */
  send(event) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("❌ WebSocket not ready");
      return;
    }

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Disconnect from Realtime API
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.sessionId = null;
    }
  }

  /**
   * Check connection status
   */
  get connected() {
    return this.isConnected;
  }
}
