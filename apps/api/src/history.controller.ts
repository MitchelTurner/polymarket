import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from './prisma.service';

function parseYear(value: string): number {
  if (!/^[1-9]\d{3}$/.test(value)) throw new BadRequestException('year must be four digits');
  return Number(value);
}

@Controller('years')
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async years() {
    const lists = await this.prisma.yisResult.findMany({
      where: { scope: 'GLOBAL' },
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'desc' },
    });
    return { years: lists.map(({ year }) => year) };
  }

  @Get(':year/categories')
  async categories(@Param('year') yearValue: string) {
    const year = parseYear(yearValue);
    const results = await this.prisma.yisResult.findMany({
      where: { year, scope: 'GLOBAL', list: 'people' },
      select: { rank: true },
    });
    const categories = results.length ? [{
      slug: 'people', name: 'People',
      complete: results.length === 10 && results.every(({ rank }) => rank >= 1 && rank <= 10),
    }] : [];
    return { year, categories };
  }

  @Get(':year/categories/:slug/results')
  async results(@Param('year') yearValue: string, @Param('slug') slug: string) {
    const year = parseYear(yearValue);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new BadRequestException('invalid category slug');
    }
    if (slug !== 'people') return { year, category: null, results: [] };
    const results = await this.prisma.yisResult.findMany({
      where: { year, scope: 'GLOBAL', list: 'people' },
      include: { person: { select: { name: true } } },
      orderBy: { rank: 'asc' },
    });
    return {
      year,
      category: results.length ? {
        slug: 'people', name: 'People',
        complete: results.length === 10 && results.every(({ rank }) => rank >= 1 && rank <= 10),
      } : null,
      results: results.map(({ rank, person, sourceUrl }) => ({ rank, query: person.name, sourceUrl })),
    };
  }
}
