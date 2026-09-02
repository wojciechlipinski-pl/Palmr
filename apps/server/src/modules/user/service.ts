import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { RegisterUserInput, UserResponseSchema } from "./dto";
import { IUserRepository, PrismaUserRepository } from "./repository";

type UserWithPassword = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  password?: string;
};

const prisma = new PrismaClient();

export class UserService {
  constructor(private readonly userRepository: IUserRepository = new PrismaUserRepository()) {}

  async register(data: RegisterUserInput) {
    const existingUser = await this.userRepository.findUserByEmail(data.email);
    const existingUsername = await this.userRepository.findUserByUsername(data.username);

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    if (existingUsername) {
      throw new Error("User with this username already exists");
    }

    const usersCount = await prisma.user.count();
    const isAdmin = usersCount === 0;

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.userRepository.createUser({
      ...data,
      password: hashedPassword,
      isAdmin,
    });

    return UserResponseSchema.parse(user);
  }

  async listUsers() {
    const users = await this.userRepository.listUsers();
    return users.map((user) => UserResponseSchema.parse(user));
  }

  // Per-user storage breakdown for the admin panel (kyantech/Palmr#167).
  async getStorageStats() {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true, firstName: true, lastName: true },
    });

    const usage = await prisma.file.groupBy({
      by: ["userId"],
      _sum: { size: true },
      _count: { _all: true },
    });
    const usageByUser = new Map(usage.map((u) => [u.userId, u]));

    return users
      .map((user) => {
        const stats = usageByUser.get(user.id);
        return {
          userId: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          totalSize: (stats?._sum.size ?? BigInt(0)).toString(),
          fileCount: stats?._count._all ?? 0,
        };
      })
      .sort((a, b) => (BigInt(b.totalSize) > BigInt(a.totalSize) ? 1 : -1));
  }

  // Failed-login audit trail for the admin panel (kyantech/Palmr#167). Only
  // ever holds rows for users with at least one recent failed attempt -
  // successful logins clear the record (see AuthService.login).
  async getLoginAttempts() {
    const attempts = await prisma.loginAttempt.findMany({
      include: { user: { select: { username: true, email: true } } },
      orderBy: { lastAttempt: "desc" },
      take: 200,
    });

    return attempts.map((a) => ({
      userId: a.userId,
      username: a.user.username,
      email: a.user.email,
      attempts: a.attempts,
      lastAttempt: a.lastAttempt.toISOString(),
    }));
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findUserById(id);
    if (!user) {
      throw new Error("User not found");
    }
    return UserResponseSchema.parse(user);
  }

  async updateUser(userId: string, data: Partial<UserWithPassword>) {
    const { password, ...rest } = data;

    const updateData: any = { ...rest };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
      updateData.passwordChangedAt = new Date();
    }

    const user = await this.userRepository.updateUser({
      id: userId,
      ...updateData,
    });

    return UserResponseSchema.parse(user);
  }

  async deleteUser(id: string) {
    const deleted = await this.userRepository.deleteUser(id);
    return UserResponseSchema.parse(deleted);
  }

  async activateUser(id: string) {
    const user = await this.userRepository.activateUser(id);
    return UserResponseSchema.parse(user);
  }

  async deactivateUser(id: string) {
    const user = await this.userRepository.deactivateUser(id);
    return UserResponseSchema.parse(user);
  }

  async updateUserImage(userId: string, imageUrl: string | null) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        image: imageUrl,
        updatedAt: new Date(),
      },
    });
    return user;
  }
}
