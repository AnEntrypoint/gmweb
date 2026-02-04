// Direct Claude Code SDK - Use Node.js SDK with permissions bypass
import { query } from '@anthropic-ai/claude-code';

export default class ACPConnection {
  constructor() {
    this.sessionId = null;
    this.onUpdate = null;
  }

  async connect(agentType, cwd) {
    console.log(`[ACP-Direct] Using Claude Code SDK with dangerously-skip-permissions mode`);
  }

  async initialize() {
    return { ready: true };
  }

  async newSession(cwd) {
    this.sessionId = Math.random().toString(36).substring(7);
    return { sessionId: this.sessionId };
  }

  async setSessionMode(modeId) {
    return { modeId };
  }

  async injectSkills() {
    return { skills: [] };
  }

  async injectSystemContext() {
    return { context: '' };
  }

  async sendPrompt(prompt) {
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(p => p.text).join('\n');
    
    console.log(`[ACP-Direct] Sending prompt to Claude Code SDK (${promptText.length} chars)`);

    try {
      // Use the SDK's query method with permissions bypass
      const response = query({
        prompt: promptText,
        options: { 
          permissionMode: 'bypassPermissions'
        }
      });

      // Collect all messages and render them beautifully
      const htmlParts = [];
      let hasStarted = false;
      let allText = '';

      for await (const message of response) {
        const msgType = message.type;
        
        // Handle assistant messages with content
        if (msgType === 'assistant' && message.message?.content) {
          if (!hasStarted) {
            hasStarted = true;
            // Add thinking indicator
            htmlParts.push(`
<div style="display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3b82f6; border-radius: 0.5rem; margin-bottom: 1rem;">
  <span style="font-size: 1.5rem;">💭</span>
  <p style="color: #1f2937; margin: 0; font-weight: 500;">Executing request...</p>
</div>`);
          }

          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                allText += block.text;
                
                // Emit update for real-time streaming
                if (this.onUpdate) {
                  this.onUpdate({
                    update: {
                      sessionUpdate: 'agent_message_chunk',
                      content: { text: block.text }
                    }
                  });
                }
                
                // Render text block
                htmlParts.push(`
<div style="padding: 1rem; background: #f3f4f6; border-radius: 0.5rem; border-left: 4px solid #3b82f6; margin-bottom: 1rem;">
  <p style="color: #1f2937; line-height: 1.6; margin: 0; white-space: pre-wrap;">${this._escapeHtml(block.text)}</p>
</div>`);
              } else if (block.type === 'tool_use') {
                // Render tool execution
                const inputJson = JSON.stringify(block.input, null, 2);
                const toolHtml = `
<div style="margin-bottom: 1.5rem;">
  <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: rgba(168, 85, 247, 0.1); border-left: 4px solid #a855f7; border-radius: 0.5rem; margin-bottom: 0.75rem;">
    <span style="font-size: 1.2rem;">🔧</span>
    <span style="color: #1f2937; font-weight: 600;">Tool Execution: <code style="background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-family: monospace; color: #7c3aed;">${this._escapeHtml(block.name)}</code></span>
  </div>
  <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem; margin-left: 2rem; border: 1px solid #e5e7eb;">
    <div style="color: #6b7280; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem;">Input Parameters:</div>
    <pre style="color: #1f2937; overflow-x: auto; margin: 0; font-size: 0.875rem; font-family: 'Courier New', monospace; line-height: 1.4;"><code>${this._escapeHtml(inputJson)}</code></pre>
  </div>
</div>`;
                
                htmlParts.push(toolHtml);
                
                // Emit update
                if (this.onUpdate) {
                  this.onUpdate({
                    update: {
                      sessionUpdate: 'agent_message_chunk',
                      content: { text: toolHtml }
                    }
                  });
                }
              }
            }
          }
        }
        
        // Handle result messages (completion)
        if (msgType === 'result') {
          const duration = message.duration_ms || 0;
          const resultHtml = `
<div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: rgba(16, 185, 129, 0.1); border-left: 4px solid #10b981; border-radius: 0.5rem;">
  <span style="font-size: 1.2rem;">✅</span>
  <p style="color: #1f2937; margin: 0; font-weight: 500;">Completed in <code style="background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-family: monospace;">${duration}ms</code></p>
</div>`;
          
          htmlParts.push(resultHtml);
          
          // Emit final update
          if (this.onUpdate) {
            this.onUpdate({
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: resultHtml }
              }
            });
          }
        }
      }

      // Combine all HTML parts
      const fullHtml = `<div style="display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem;">\n${htmlParts.join('\n')}\n</div>`;
      
      console.log(`[ACP-Direct] ✓ Response rendered (${fullHtml.length} chars)`);
      return { content: fullHtml || 'No response from agent' };
    } catch (err) {
      console.error(`[ACP-Direct] Query error: ${err.message}`);
      throw err;
    }
  }

  _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  isRunning() {
    return true;
  }

  async terminate() {
    return;
  }
}
