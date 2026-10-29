import { Prisma } from '@prisma/client';
import { Database } from '../../infrastructure/database';
import { AppError } from '../../shared/errors';
import { PasswordHasher, Tokens } from './security';
const publicUser = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;
export class AuthService {
  private readonly dummyHash: Promise<string>;
  constructor(
    private readonly db: Database,
    private readonly passwords: PasswordHasher,
    private readonly tokens: Tokens,
  ) {
    this.dummyHash = passwords.hash('dummy-timing-value');
  }
  async register(data: { email: string; name: string; password: string }) {
    const passwordHash = await this.passwords.hash(data.password);
    try {
      const user = await this.db.user.create({
        data: { email: data.email, name: data.name, passwordHash },
        select: publicUser,
      });
      return {
        user,
        accessToken: this.tokens.sign({
          sub: user.id,
          role: user.role,
          version: 0,
        }),
        expiresIn: 900,
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new AppError(409, 'EMAIL_EXISTS', 'Email already registered');
      throw e;
    }
  }
  async login(data: { email: string; password: string }) {
    const user = await this.db.user.findUnique({
      where: { email: data.email },
    });
    const valid = await this.passwords.verify(
      data.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid) {
      await this.db.auditEvent.create({
        data: { action: 'auth.login_failed' },
      });
      throw new AppError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }
    if (this.passwords.needsRehash?.(user.passwordHash)) {
      await this.db.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: await this.passwords.hash(data.password) },
      });
    }
    const { passwordHash: _, ...safe } = user;
    void _;
    return {
      user: safe,
      accessToken: this.tokens.sign({
        sub: user.id,
        role: user.role,
        version: user.sessionVersion,
      }),
      expiresIn: 900,
    };
  }
  async me(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: publicUser,
    });
    if (!user)
      throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');
    return user;
  }
}
