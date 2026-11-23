import { PrismaClient } from '@prisma/client';

// Supplied lists; no external source URL or release/window dates were supplied.
const lists = [
  { year: 2014, people: [
    'Jennifer Lawrence', 'Kim Kardashian', 'Julie Gayet', 'Tracy Morgan', 'Renee Zellweger',
    'Jared Leto', 'Lorde', 'Matthew McConaughey', 'Amal Alamuddin', 'Donald Sterling',
  ] },
  { year: 2018, people: [
    'Meghan Markle', 'Demi Lovato', 'Sylvester Stallone', 'Logan Paul', 'Khloé Kardashian',
    'Jair Bolsonaro', 'Brett Kavanaugh', 'Hailey Baldwin', 'Stormy Daniels', 'Cardi B',
  ] },
  { year: 2021, people: [
    'Alec Baldwin', 'Kyle Rittenhouse', 'Christian Eriksen', 'Tiger Woods', 'Simone Biles',
    'Joe Biden', 'Emma Raducanu', 'Derek Chauvin', 'Henry Ruggs III', 'Pete Davidson',
  ] },
  { year: 2022, people: [
    'Johnny Depp', 'Will Smith', 'Amber Heard', 'Vladimir Putin', 'Chris Rock',
    'Novak Djokovic', 'Anna Sorokin (Delvey)', 'Andrew Tate', 'Rishi Sunak', 'Simon Leviev',
  ] },
  { year: 2023, people: [
    'Damar Hamlin', 'Jeremy Renner', 'Andrew Tate', 'Kylian Mbappé', 'Travis Kelce',
    'Jenna Ortega', 'Lil Tay', 'Danny Masterson', 'David Beckham', 'Pedro Pascal',
  ] },
  { year: 2024, people: [
    'Donald Trump', 'Catherine Princess of Wales', 'Kamala Harris', 'Imane Khelif', 'Joe Biden',
    'Mike Tyson', 'JD Vance', 'Lamine Yamal', 'Simone Biles', 'Diddy',
  ] },
  { year: 2025, people: [
    'd4vd', 'Kendrick Lamar', 'Jimmy Kimmel', 'Tyler Robinson', 'Pope Leo XIV',
    'Shedeur Sanders', 'Bianca Censori', 'Zohran Mamdani', 'Greta Thunberg', 'Sanae Takaichi',
  ] },
];

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const { year, people } of lists) {
    await prisma.$transaction(async (tx) => {
      await tx.season.upsert({
        where: { year }, create: { year, status: 'historical' }, update: {},
      });
      await tx.yisResult.deleteMany({ where: { year, scope: 'GLOBAL', list: 'people' } });
      for (const [index, name] of people.entries()) {
        const person = await tx.person.upsert({ where: { name }, create: { name }, update: {} });
        await tx.yisResult.create({ data: {
          year, scope: 'GLOBAL', list: 'people', personId: person.id, rank: index + 1,
        } });
      }
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
