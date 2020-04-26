import { HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { of, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { DataService } from '../api/data.service';
import { FlowsService } from '../flows/flows.service';
import { CheckSessionService } from '../iframe';
import { LoggerService } from '../logging/logger.service';
import { StoragePersistanceService } from '../storage';
import { UrlService } from '../utils';

@Injectable()
export class LogoffRevocationService {
    constructor(
        private dataService: DataService,
        private storagePersistanceService: StoragePersistanceService,
        private loggerService: LoggerService,
        private urlService: UrlService,
        private checkSessionService: CheckSessionService,
        private flowsService: FlowsService
    ) {}

    // Logs out on the server and the local client.
    // If the server state has changed, checksession, then only a local logout.
    logoff(urlHandler?: (url: string) => any) {
        this.loggerService.logDebug('logoff, remove auth ');
        const endSessionUrl = this.getEndSessionUrl();
        this.flowsService.resetAuthorizationData();

        if (!endSessionUrl) {
            this.loggerService.logDebug('only local login cleaned up, no end_session_endpoint');
            return;
        }

        if (this.checkSessionService.serverStateChanged()) {
            this.loggerService.logDebug('only local login cleaned up, server session has changed');
        } else if (urlHandler) {
            urlHandler(endSessionUrl);
        } else {
            this.redirectTo(endSessionUrl);
        }
    }

    // The refresh token and and the access token are revoked on the server. If the refresh token does not exist
    // only the access token is revoked. Then the logout run.
    logoffAndRevokeTokens(urlHandler?: (url: string) => any) {
        if (this.storagePersistanceService.getRefreshToken()) {
            return this.revokeRefreshToken().pipe(
                switchMap((result) => this.revokeAccessToken(result)),
                catchError((error) => {
                    const errorMessage = `revoke token failed ${error}`;
                    this.loggerService.logError(errorMessage);
                    return throwError(errorMessage);
                }),
                tap(() => this.logoff(urlHandler))
            );
        } else {
            return this.revokeAccessToken().pipe(
                catchError((error) => {
                    const errorMessage = `revoke access token failed ${error}`;
                    this.loggerService.logError(errorMessage);
                    return throwError(errorMessage);
                }),
                tap(() => this.logoff(urlHandler))
            );
        }
    }

    // https://tools.ietf.org/html/rfc7009
    // revokes an access token on the STS. If no token is provided, then the token from
    // the storage is revoked. You can pass any token to revoke. This makes it possible to
    // manage your own tokens. The is a public API.
    revokeAccessToken(accessToken?: any) {
        const accessTok = accessToken || this.storagePersistanceService.accessToken;
        const body = this.urlService.createRevocationEndpointBodyAccessToken(accessTok);
        const url = this.urlService.getRevocationEndpointUrl();

        let headers: HttpHeaders = new HttpHeaders();
        headers = headers.set('Content-Type', 'application/x-www-form-urlencoded');

        return this.dataService.post(url, body, headers).pipe(
            switchMap((response: any) => {
                this.loggerService.logDebug('revocation endpoint post response: ', response);
                return of(response);
            }),
            catchError((error) => {
                const errorMessage = `Revocation request failed ${error}`;
                this.loggerService.logError(errorMessage);
                return throwError(errorMessage);
            })
        );
    }

    // https://tools.ietf.org/html/rfc7009
    // revokes an refresh token on the STS. This is only required in the code flow with refresh tokens.
    // If no token is provided, then the token from the storage is revoked. You can pass any token to revoke.
    // This makes it possible to manage your own tokens.
    revokeRefreshToken(refreshToken?: any) {
        const refreshTok = refreshToken || this.storagePersistanceService.getRefreshToken();
        const body = this.urlService.createRevocationEndpointBodyRefreshToken(refreshTok);
        const url = this.urlService.getRevocationEndpointUrl();

        let headers: HttpHeaders = new HttpHeaders();
        headers = headers.set('Content-Type', 'application/x-www-form-urlencoded');

        return this.dataService.post(url, body, headers).pipe(
            switchMap((response: any) => {
                this.loggerService.logDebug('revocation endpoint post response: ', response);
                return of(response);
            }),
            catchError((error) => {
                const errorMessage = `Revocation request failed ${error}`;
                this.loggerService.logError(errorMessage);
                return throwError(errorMessage);
            })
        );
    }

    getEndSessionUrl(): string | null {
        const idTokenHint = this.storagePersistanceService.idToken;
        return this.urlService.createEndSessionUrl(idTokenHint);
    }

    private redirectTo(url: string) {
        window.location.href = url;
    }
}
