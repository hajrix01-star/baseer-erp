-- Future providers are explicit enum members so their configuration, audit and
-- pricing records can be typed when their individual activation gates pass.
-- No credential, endpoint or live provider configuration is created here.
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'DASHSCOPE_QWEN';
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'DEEPSEEK';
