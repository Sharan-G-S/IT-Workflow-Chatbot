const { ChatOpenAI } = require('@langchain/openai');
const { PromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');

/**
 * Base Agent class for LangChain-based IT workflow agents
 * Provides common functionality for all specialized agents
 */
class BaseAgent {
  constructor(config = {}) {
    this.name = config.name || 'BaseAgent';
    this.description = config.description || 'Base agent for IT workflows';
    this.model = new ChatOpenAI({
      modelName: config.model || 'gpt-4o-mini',
      temperature: config.temperature || 0.1,
      maxTokens: config.maxTokens || 1000
    });
    this.outputParser = new StringOutputParser();
    this.context = config.context || {};
  }

  /**
   * Create a prompt template for this agent
   */
  createPrompt(template) {
    return PromptTemplate.fromTemplate(template);
  }

  /**
   * Create a runnable chain for this agent
   */
  createChain(prompt) {
    return RunnableSequence.from([
      prompt,
      this.model,
      this.outputParser
    ]);
  }

  /**
   * Execute the agent with given input
   */
  async execute(input, context = {}) {
    try {
      const mergedContext = { ...this.context, ...context };
      const result = await this.run(input, mergedContext);
      return {
        success: true,
        agent: this.name,
        input,
        output: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        agent: this.name,
        input,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Main execution method - to be implemented by subclasses
   */
  async run(input, context) {
    throw new Error('run() method must be implemented by subclasses');
  }

  /**
   * Check if this agent can handle the given input
   */
  canHandle(input, context = {}) {
    return false; // Default implementation
  }

  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      model: this.model.modelName,
      temperature: this.model.temperature
    };
  }
}

module.exports = BaseAgent;