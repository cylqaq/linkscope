import { Test, TestingModule } from '@nestjs/testing'
import { HealthController } from '../health.controller'
import { PrismaService } from '../../prisma/prisma.service'
import { getQueueToken } from '@nestjs/bull'

describe('HealthController', () => {
  let controller: HealthController
  let prismaService: PrismaService

  beforeEach(async () => {
    const mockPrismaService = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    }

    const mockQueue = {
      client: {
        ping: jest.fn().mockResolvedValue('PONG'),
      },
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(0),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: getQueueToken('probe'),
          useValue: mockQueue,
        },
      ],
    }).compile()

    controller = module.get<HealthController>(HealthController)
    prismaService = module.get<PrismaService>(PrismaService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('getHealth', () => {
    it('should return healthy status when all components are healthy', async () => {
      const result = await controller.getHealth()

      expect(result.status).toBe('healthy')
      expect(result.components.database.status).toBe('healthy')
      expect(result.components.redis.status).toBe('healthy')
      expect(result.components.queue.status).toBe('healthy')
    })

    it('should return unhealthy status when database check fails', async () => {
      jest.spyOn(prismaService, '$queryRaw').mockRejectedValue(new Error('Connection failed'))

      const result = await controller.getHealth()

      expect(result.status).toBe('unhealthy')
      expect(result.components.database.status).toBe('unhealthy')
    })
  })

  describe('getReadiness', () => {
    it('should return ready when service is healthy', async () => {
      const result = await controller.getReadiness()

      expect(result.ready).toBe(true)
      expect(result.message).toBe('Service is ready')
    })
  })

  describe('getLiveness', () => {
    it('should return alive status', () => {
      const result = controller.getLiveness()

      expect(result.alive).toBe(true)
      expect(result.timestamp).toBeDefined()
    })
  })
})
