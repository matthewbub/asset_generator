#!/usr/bin/env node

import 'dotenv/config';
import inquirer from 'inquirer';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

interface ImageGenerationResult {
  filename: string;
  filepath: string;
  imageCallId?: string;
}

interface SystemPromptConfig {
  systemPrompt: string;
  enabled: boolean;
  maxSize: boolean;
}

const CONFIG_FILE = path.join(process.cwd(), '.asset-generator-config.json');
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const ENV_FILE = path.join(process.cwd(), '.env');

function loadSystemPromptConfig(): SystemPromptConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        systemPrompt: config.systemPrompt || '',
        enabled: config.enabled || false,
        maxSize: config.maxSize || false
      };
    }
  } catch (error) {
    console.warn('Warning: Could not load system prompt config, using defaults');
  }
  return { systemPrompt: '', enabled: false, maxSize: false };
}

function saveSystemPromptConfig(config: SystemPromptConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving system prompt config:', error);
  }
}

function combinePrompts(userPrompt: string, systemPrompt?: string): string {
  if (!systemPrompt || !systemPrompt.trim()) {
    return userPrompt;
  }
  return `${systemPrompt}\n\n${userPrompt}`;
}

async function promptForApiKey(): Promise<string> {
  console.log('\n🔑 OpenAI API Key Setup');
  console.log('Your API key is required to generate images.');
  console.log('You can find your API key at: https://platform.openai.com/api-keys\n');
  
  const answer = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your OpenAI API key:',
      mask: '*',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'API key is required';
        }
        if (!input.startsWith('sk-')) {
          return 'OpenAI API keys should start with "sk-"';
        }
        return true;
      }
    }
  ]);
  
  return answer.apiKey.trim();
}

async function validateApiKey(apiKey: string): Promise<boolean> {
  console.log('\n🔍 Validating API key...');
  
  try {
    const openai = new OpenAI({ apiKey });
    await openai.models.list();
    console.log('✅ API key is valid!');
    return true;
  } catch (error) {
    console.log('❌ API key validation failed.');
    if (error instanceof Error) {
      console.log(`Error: ${error.message}`);
    }
    return false;
  }
}

function writeEnvFile(apiKey: string): void {
  try {
    let envContent = '';
    
    if (fs.existsSync(ENV_FILE)) {
      envContent = fs.readFileSync(ENV_FILE, 'utf8');
      
      if (envContent.includes('OPENAI_API_KEY=')) {
        envContent = envContent.replace(/OPENAI_API_KEY=.*$/m, `OPENAI_API_KEY=${apiKey}`);
      } else {
        envContent += `\nOPENAI_API_KEY=${apiKey}`;
      }
    } else {
      envContent = `OPENAI_API_KEY=${apiKey}\n`;
    }
    
    fs.writeFileSync(ENV_FILE, envContent);
    console.log('✅ API key saved to .env file');
  } catch (error) {
    console.error('❌ Error writing to .env file:', error);
    throw error;
  }
}

async function checkEnvSetup(): Promise<void> {
  while (!process.env.OPENAI_API_KEY) {
    const apiKey = await promptForApiKey();
    
    if (await validateApiKey(apiKey)) {
      writeEnvFile(apiKey);
      process.env.OPENAI_API_KEY = apiKey;
      console.log('\n🎉 Setup complete! You can now generate images.\n');
      break;
    } else {
      console.log('\n🔄 Please try again with a valid API key.\n');
    }
  }
}

async function generateAssetWithResponses(prompt: string, previousImageCallId?: string): Promise<ImageGenerationResult> {
  const config = loadSystemPromptConfig();
  const finalPrompt = config.enabled ? combinePrompts(prompt, config.systemPrompt) : prompt;
  
  console.log('\nYour prompt:');
  console.log(prompt);
  if (config.enabled && config.systemPrompt) {
    console.log('\n📝 System prompt applied:');
    console.log(config.systemPrompt);
  }
  
  console.log('\n🚀 Processing with AI (Responses API)...');
  
  try {
    const openai = new OpenAI();
    
    let input: any;
    if (previousImageCallId) {
      input = [
        {
          role: "user",
          content: [{ type: "input_text", text: finalPrompt }],
        },
        {
          type: "image_generation_call",
          id: previousImageCallId,
        },
      ];
    } else {
      input = finalPrompt;
    }
    
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: input,
      tools: [{ type: "image_generation" }],
    });

    const imageGenerationCalls = response.output.filter(
      (output) => output.type === "image_generation_call"
    );

    if (imageGenerationCalls.length === 0) {
      throw new Error('No image generation calls found in response');
    }

    const imageData = imageGenerationCalls.map((output) => output.result);
    
    if (imageData.length === 0) {
      throw new Error('No image data received from OpenAI');
    }
    
    const imageBase64 = imageData[0];
    if (!imageBase64) {
      throw new Error('No base64 image data received from OpenAI');
    }
    
    const imageCallId = imageGenerationCalls[0].id;
    
    const image_bytes = Buffer.from(imageBase64, "base64");
    const timestamp = Date.now();
    const filename = `generated_${timestamp}_${imageCallId}.png`;
    const filepath = path.join(ASSETS_DIR, filename);
    
    if (!fs.existsSync(ASSETS_DIR)) {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }
    fs.writeFileSync(filepath, image_bytes);
    
    console.log(`\n✅ Image generated successfully!`);
    console.log(`📁 Saved as: ${filename}`);
    console.log(`📍 Full path: ${filepath}`);
    console.log(`🔗 Image Call ID: ${imageCallId}`);
    
    return { filename, filepath, imageCallId };
    
  } catch (error) {
    console.error('\n❌ Error generating image:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

async function generateAssetLegacy(prompt: string): Promise<ImageGenerationResult> {
  const config = loadSystemPromptConfig();
  const finalPrompt = config.enabled ? combinePrompts(prompt, config.systemPrompt) : prompt;
  
  console.log('\nYour prompt:');
  console.log(prompt);
  if (config.enabled && config.systemPrompt) {
    console.log('\n📝 System prompt applied:');
    console.log(config.systemPrompt);
  }
  
  const sizeText = config.maxSize ? ' (Maximum Size)' : '';
  console.log(`\n🚀 Processing with AI (Legacy API)${sizeText}...`);
  
  try {
    const openai = new OpenAI();
    
    let imageSize: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024";
    if (config.maxSize) {
      const orientation = await inquirer.prompt([
        {
          type: 'list',
          name: 'orientation',
          message: 'Choose maximum size orientation:',
          choices: [
            { name: 'Landscape (1792x1024)', value: '1792x1024' },
            { name: 'Portrait (1024x1792)', value: '1024x1792' }
          ]
        }
      ]);
      imageSize = orientation.orientation;
    }
    
    const result = await openai.images.generate({
      model: "dall-e-3",
      prompt: finalPrompt,
      size: imageSize,
      quality: "hd",
      response_format: "b64_json"
    });

    if (!result.data || result.data.length === 0) {
      throw new Error('No image data received from OpenAI');
    }
    
    const image_base64 = result.data[0].b64_json;
    if (!image_base64) {
      throw new Error('No base64 image data received from OpenAI');
    }
    
    const image_bytes = Buffer.from(image_base64, "base64");
    const filename = `generated_${Date.now()}.png`;
    const filepath = path.join(ASSETS_DIR, filename);
    
    if (!fs.existsSync(ASSETS_DIR)) {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }
    fs.writeFileSync(filepath, image_bytes);
    
    console.log(`\n✅ Image generated successfully!`);
    console.log(`📁 Saved as: ${filename}`);
    console.log(`📍 Full path: ${filepath}`);
    
    return { filename, filepath };
    
  } catch (error) {
    console.error('\n❌ Error generating image:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

function extractImageCallIdFromFilename(filename: string): string | null {
  const match = filename.match(/generated_\d+_([^.]+)\.png$/);
  return match ? match[1] : null;
}

function listGeneratedImages(): string[] {
  if (!fs.existsSync(ASSETS_DIR)) {
    return [];
  }
  const files = fs.readdirSync(ASSETS_DIR);
  return files.filter(file => file.startsWith('generated_') && file.endsWith('.png'));
}

async function manageSystemPrompt(): Promise<void> {
  const config = loadSystemPromptConfig();
  
  const action = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'System Prompt Management:',
      choices: [
        'Set system prompt',
        'View current system prompt',
        config.enabled ? 'Disable system prompt' : 'Enable system prompt',
        config.maxSize ? 'Disable max size mode' : 'Enable max size mode',
        'Clear system prompt',
        'Back to main menu'
      ]
    }
  ]);
  
  switch (action.action) {
    case 'Set system prompt':
      const promptAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'prompt',
          message: 'Enter your system prompt:',
          default: config.systemPrompt
        }
      ]);
      saveSystemPromptConfig({ systemPrompt: promptAnswer.prompt, enabled: true, maxSize: config.maxSize });
      console.log('✅ System prompt saved and enabled!');
      break;
      
    case 'View current system prompt':
      if (config.systemPrompt) {
        console.log(`\n📝 Current system prompt (${config.enabled ? 'enabled' : 'disabled'}):`);
        console.log(config.systemPrompt);
      } else {
        console.log('\n❌ No system prompt set');
      }
      break;
      
    case 'Enable system prompt':
      if (config.systemPrompt) {
        saveSystemPromptConfig({ ...config, enabled: true });
        console.log('✅ System prompt enabled!');
      } else {
        console.log('❌ No system prompt to enable. Set one first.');
      }
      break;
      
    case 'Disable system prompt':
      saveSystemPromptConfig({ ...config, enabled: false });
      console.log('✅ System prompt disabled!');
      break;
      
    case 'Enable max size mode':
      saveSystemPromptConfig({ ...config, maxSize: true });
      console.log('✅ Max size mode enabled! (Legacy API will use 1792x1024 or 1024x1792)');
      break;
      
    case 'Disable max size mode':
      saveSystemPromptConfig({ ...config, maxSize: false });
      console.log('✅ Max size mode disabled!');
      break;
      
    case 'Clear system prompt':
      saveSystemPromptConfig({ systemPrompt: '', enabled: false, maxSize: false });
      console.log('✅ System prompt cleared!');
      break;
  }
  
  if (action.action !== 'Back to main menu') {
    await manageSystemPrompt();
  }
}

async function startInteractiveSession() {
  console.log('🎨 Welcome to AI Asset Generator!');
  console.log('Generate stunning images with AI-powered prompts.\n');
  
  await checkEnvSetup();
  
  let lastImageResult: ImageGenerationResult | null = null;
  
  while (true) {
    const generatedImages = listGeneratedImages();
    const config = loadSystemPromptConfig();
    const choices = ['Generate new image', 'Use legacy API'];
    
    if (lastImageResult?.imageCallId) {
      choices.splice(1, 0, 'Refine last image');
    }
    
    if (generatedImages.length > 0) {
      choices.splice(-1, 0, 'Refine existing image');
    }
    
    const systemStatus = config.enabled ? 'enabled' : 'disabled';
    const maxSizeStatus = config.maxSize ? ', max size' : '';
    choices.push(`Manage system prompt (${systemStatus}${maxSizeStatus})`);
    choices.push('Quit');
    
    const modeAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'What would you like to do?',
        choices: choices
      }
    ]);
    
    if (modeAnswer.mode === 'Quit') {
      console.log('\n👋 Thanks for using AI Asset Generator!');
      break;
    }
    
    if (modeAnswer.mode.startsWith('Manage system prompt')) {
      await manageSystemPrompt();
      continue;
    }
    
    let selectedImageCallId: string | undefined;
    
    if (modeAnswer.mode === 'Refine existing image') {
      const imageChoices = generatedImages
        .filter(img => extractImageCallIdFromFilename(img))
        .map(img => ({
          name: `${img} (ID: ${extractImageCallIdFromFilename(img)})`,
          value: img
        }));
      
      if (imageChoices.length === 0) {
        console.log('\n❌ No images with refinement capability found.');
        continue;
      }
      
      const imageAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'image',
          message: 'Select an image to refine:',
          choices: imageChoices
        }
      ]);
      
      selectedImageCallId = extractImageCallIdFromFilename(imageAnswer.image) || undefined;
    } else if (modeAnswer.mode === 'Refine last image') {
      selectedImageCallId = lastImageResult?.imageCallId;
    }
    
    const promptAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'prompt',
        message: selectedImageCallId 
          ? 'Enter refinement instructions:' 
          : 'Enter your AI prompt:',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Please enter a prompt';
          }
          return true;
        }
      }
    ]);
    
    try {
      if (modeAnswer.mode === 'Use legacy API') {
        lastImageResult = await generateAssetLegacy(promptAnswer.prompt);
      } else if (selectedImageCallId) {
        lastImageResult = await generateAssetWithResponses(promptAnswer.prompt, selectedImageCallId);
      } else {
        lastImageResult = await generateAssetWithResponses(promptAnswer.prompt);
      }
    } catch (error) {
      console.error('\n❌ Failed to generate image. Please try again.');
      continue;
    }
    
    const continueAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Continue?',
        default: true
      }
    ]);
    
    if (!continueAnswer.continue) {
      console.log('\n👋 Thanks for using AI Asset Generator!');
      break;
    }
    
    console.log(''); // Add spacing for next iteration
  }
}

startInteractiveSession().catch((error) => {
  console.error('An error occurred:', error);
  process.exit(1);
});
